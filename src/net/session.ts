/**
 * 호스트 없는 결정론적 락스텝 세션.
 *
 * 핵심 원리
 * - 모든 피어가 같은 월드를 시뮬레이션하고, 매 틱 자신의 입력만 브로드캐스트한다.
 * - 틱 t 는 그 틱에 "활성"인 모든 멤버의 입력이 모였을 때만 진행된다 → 항상 동일한 결과.
 * - 멤버십(참가/이탈)은 "코디네이터"가 특정 틱에 발효되도록 공표한다. 코디네이터는 현재 활성 멤버 중
 *   가장 작은 pid 를 가진 피어이며, 상태가 모두에게 복제되어 있으므로 누구나 즉시 그 역할을 이어받는다.
 *   즉 방장 개념이 없고, 누가 나가도 남은 피어끼리 계속 진행된다.
 * - 늦게 참가한 피어는 코디네이터로부터 특정 틱의 스냅샷을 받고 그 틱부터 입력을 재생한다.
 * - 주기적 상태 해시로 디싱크를 검출하고, 어긋난 피어는 스냅샷으로 재동기화한다.
 */
import { World, type TickFrame, type JoinEvent } from '../sim/world';
import { serializeWorld, deserializeWorld, hashWorld } from '../sim/serialize';
import { EMPTY_INPUT, INPUT_BYTES, encodeInput, decodeInput, inputEquals, type Input } from '../sim/input';
import { hashString } from '../sim/rng';
import { TICK_RATE } from '../sim/types';
import type { Transport, ControlMsg, MemberInfo } from './transport';
import { t as tr } from '../render/i18n';

export const INPUT_DELAY = 2; // 틱 (67ms)
const TICK_MS = 1000 / TICK_RATE;
const MAX_AHEAD = 45; // 시뮬보다 앞서 보낼 수 있는 최대 입력 틱 수
const HISTORY_TICKS = 900;
const HASH_INTERVAL = 60;
const DISCOVER_MS = 5000;
const LEAVE_QUERY_MS = 700;
const STALL_KICK_MS = 4000;
const STALL_REQ_MS = 800;
const MAX_STEPS_PER_FRAME = 6;

export type Phase = 'discover' | 'joining' | 'playing' | 'resync';

export interface SessionStatus {
  phase: Phase;
  pid: number;
  tick: number;
  members: number;
  coordinator: boolean;
  stalledMs: number;
  desyncs: number;
  message: string;
  /** 연결 화면용: 직접 연결된 피어 수, 릴레이 상태, 세션 시작 후 경과 ms, 방 코드 */
  peers: number;
  relays: { open: number; total: number } | null;
  elapsedMs: number;
  room: string;
  offline: boolean;
}

interface Member extends MemberInfo {}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const b = atob(s);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export class Session {
  world: World | null = null;
  phase: Phase = 'discover';
  pid = 0;
  session = '';
  members = new Map<number, Member>();
  private peerToPid = new Map<string, number>();
  private inputs = new Map<number, Map<number, Input>>();
  private localTick = 0; // 다음에 보낼 입력 틱
  private latestSent = -1;
  private tickAcc = 0;
  private lastNow = 0;
  private startedAt = 0;
  private pendingSnaps: { peerId: string; tick: number }[] = [];
  private waitingSnapAt = -1;
  private joinTarget: string | null = null;
  private candidates = new Map<string, { pid: number; session: string; members: MemberInfo[] }>();
  private leaveQueries = new Map<number, { pid: number; deadline: number; replies: Map<string, { lastTick: number }> }>();
  private nextQid = 1;
  private hashes = new Map<number, Map<number, number>>();
  private stallSince = 0;
  private lastReqAt = 0;
  private lastStallKickCheck = new Map<number, number>();
  desyncs = 0;
  message = '';
  /** 채팅 수신 (시뮬 상태와 무관, 전송 계층 메시지) */
  onChat: ((pid: number, name: string, text: string) => void) | null = null;
  private log: (s: string) => void;

  constructor(private transport: Transport, private name: string, private roomId: string, log?: (s: string) => void) {
    this.log = log ?? ((s) => console.log('[net]', s));
    transport.onPeerJoin = (id) => this.onPeerJoin(id);
    transport.onPeerLeave = (id) => this.onPeerLeave(id);
    transport.onControl = (m, f) => this.onControl(m, f);
    transport.onInputs = (b, f) => this.onInputs(b, f);
    transport.onSnapshot = (b, f) => this.onSnapshot(b, f);
  }

  // ---------- 상태 조회 ----------
  status(now: number): SessionStatus {
    return {
      phase: this.phase, pid: this.pid, tick: this.world?.tick ?? 0,
      members: this.activeMembers(this.world?.tick ?? 0).length,
      coordinator: this.isCoordinator(), stalledMs: this.stallSince ? now - this.stallSince : 0,
      desyncs: this.desyncs, message: this.message,
      peers: this.transport.peers().length, relays: this.transport.relayCounts?.() ?? null,
      elapsedMs: this.startedAt ? now - this.startedAt : 0, room: this.roomId, offline: this.transport.relayCounts === undefined,
    };
  }

  private activeMembers(tick: number): Member[] {
    const out: Member[] = [];
    for (const m of this.members.values()) if (m.joinTick <= tick && (m.leaveTick < 0 || tick < m.leaveTick)) out.push(m);
    return out;
  }
  private coordinatorPid(tick: number, exclude = -1): number {
    let best = -1;
    for (const m of this.activeMembers(tick)) if (m.pid !== exclude && (best < 0 || m.pid < best)) best = m.pid;
    return best;
  }
  isCoordinator(): boolean {
    return this.phase === 'playing' && this.world !== null && this.coordinatorPid(this.world.tick) === this.pid;
  }
  private coordinatorPeer(): string | null {
    if (!this.world) return null;
    const cp = this.coordinatorPid(this.world.tick);
    const m = this.members.get(cp);
    return m ? m.peerId : null;
  }

  // ---------- 수명주기 ----------
  start(now: number): void {
    this.startedAt = now;
    this.lastNow = now;
    for (const p of this.transport.peers()) this.transport.sendControl({ t: 'hello', name: this.name }, p);
    if (this.transport.peers().length === 0 && this.transport.selfId === 'local') this.becomeFounder();
  }

  private becomeFounder(): void {
    this.session = this.transport.selfId;
    this.pid = 1;
    this.world = new World(hashString(this.roomId + '|' + this.session) | 0);
    this.members.clear();
    this.members.set(1, { pid: 1, peerId: this.transport.selfId, name: this.name, joinTick: 0, leaveTick: -1 });
    this.peerToPid.set(this.transport.selfId, 1);
    this.localTick = 0;
    this.latestSent = -1;
    this.phase = 'playing';
    this.message = tr('founder');
    this.log('founder, session=' + this.session);
  }

  private resetToJoin(target: string): void {
    this.world = null;
    this.members.clear();
    this.peerToPid.clear();
    this.inputs.clear();
    this.pid = 0;
    this.session = '';
    this.phase = 'joining';
    this.joinTarget = target;
    this.transport.sendControl({ t: 'joinreq', name: this.name }, target);
    this.message = tr('joinReq');
  }

  // ---------- 피어 이벤트 ----------
  private onPeerJoin(peerId: string): void {
    this.transport.sendControl({ t: 'hello', name: this.name }, peerId);
    if (this.phase === 'playing' && this.world) this.sendState(peerId);
    if (this.phase === 'joining' && this.joinTarget === peerId) this.transport.sendControl({ t: 'joinreq', name: this.name }, peerId);
  }

  private onPeerLeave(peerId: string): void {
    this.log(`peer left ${peerId} pid=${this.peerToPid.get(peerId)} coord=${this.world ? this.coordinatorPid(this.world.tick, this.peerToPid.get(peerId) ?? -1) : -1}`);
    const pid = this.peerToPid.get(peerId);
    if (pid === undefined || !this.world) return;
    const m = this.members.get(pid);
    if (!m || m.leaveTick >= 0) return;
    if ([...this.leaveQueries.values()].some((q) => q.pid === pid)) return;
    // 코디네이터(이탈자 제외)가 이탈 절차를 시작한다
    if (this.coordinatorPid(this.world.tick, pid) === this.pid) this.startLeave(pid);
  }

  private sendState(peerId: string): void {
    if (!this.world) return;
    this.transport.sendControl({ t: 'state', pid: this.pid, session: this.session, tick: this.world.tick, members: [...this.members.values()] }, peerId);
  }

  // ---------- 제어 메시지 ----------
  private onControl(m: ControlMsg, from: string): void {
    switch (m.t) {
      case 'hello':
        if (this.phase === 'playing') this.sendState(from);
        break;
      case 'state': {
        if (this.phase === 'discover' || this.phase === 'joining') {
          this.candidates.set(from, { pid: m.pid, session: m.session, members: m.members });
          if (this.phase === 'discover') this.tryJoinCandidate();
        } else if (this.phase === 'playing' && m.session !== this.session) {
          // 두 그룹이 만남(창립 경합): 세션 id 가 큰 쪽이 양보하고 재참가
          if (this.session > m.session) {
            this.log('founder race lost, rejoining ' + from);
            this.candidates.clear();
            this.candidates.set(from, { pid: m.pid, session: m.session, members: m.members });
            this.phase = 'discover';
            this.tryJoinCandidate();
          }
        }
        break;
      }
      case 'joinreq':
        if (this.isCoordinator()) this.admit(from, m.name);
        break;
      case 'join': {
        if (this.phase === 'joining' && m.peerId === this.transport.selfId) {
          this.pid = m.pid;
          this.session = m.session;
          this.localTick = m.atTick;
          this.latestSent = m.atTick - 1;
          this.waitingSnapAt = m.atTick;
          this.message = tr('admitted', { pid: m.pid });
        }
        if (m.session !== this.session && this.phase === 'playing') break;
        this.members.set(m.pid, { pid: m.pid, peerId: m.peerId, name: m.name, joinTick: m.atTick, leaveTick: -1 });
        this.peerToPid.set(m.peerId, m.pid);
        break;
      }
      case 'leaveq': {
        const hist = this.inputs.get(m.pid);
        let last = -1;
        if (hist) for (const t of hist.keys()) if (t > last) last = t;
        const r = this.packRange(m.pid, Math.max(0, last - 120), last);
        this.transport.sendControl({ t: 'leaver', pid: m.pid, qid: m.qid, lastTick: last, fromTick: r.start, inputsB64: b64(r.bytes) }, from);
        break;
      }
      case 'leaver': {
        const q = this.leaveQueries.get(m.qid);
        if (!q) break;
        q.replies.set(from, { lastTick: m.lastTick });
        if (m.lastTick >= 0) this.storeInputs(m.pid, m.fromTick, unb64(m.inputsB64));
        break;
      }
      case 'leave':
        this.applyLeave(m.pid, m.atTick, m.fromTick, unb64(m.inputsB64));
        break;
      case 'snapreq':
        if (this.isCoordinator()) {
          const at = this.latestSent + 1;
          this.transport.sendControl({ t: 'snapat', tick: at }, from);
          this.pendingSnaps.push({ peerId: from, tick: at });
        }
        break;
      case 'snapat':
        if (this.phase === 'resync') { this.waitingSnapAt = m.tick; this.message = tr('admitted', { pid: this.pid }) + ` (tick ${m.tick})`; }
        break;
      case 'req': {
        const bytes = this.packInputs(m.pid, m.from, m.to);
        if (bytes.length > 10) this.transport.sendInputs(bytes, from);
        break;
      }
      case 'bye':
        // 정상 종료 통지: WebRTC 끊김 감지를 기다리지 않고 즉시 이탈 절차
        this.onPeerLeave(from);
        break;
      case 'chat': {
        const pid = this.peerToPid.get(from) ?? 0;
        const mem = pid ? this.members.get(pid) : undefined;
        if (this.onChat) this.onChat(pid, mem?.name ?? '?', String(m.text).slice(0, 120));
        break;
      }
      case 'hash': {
        let map = this.hashes.get(m.tick);
        if (!map) { map = new Map(); this.hashes.set(m.tick, map); }
        const pid = this.peerToPid.get(from);
        const mem = pid !== undefined ? this.members.get(pid) : undefined;
        if (pid !== undefined && mem && mem.leaveTick < 0) { map.set(pid, m.hash); this.checkHashes(m.tick); }
        break;
      }
    }
  }

  private tryJoinCandidate(): void {
    // 후보 중 세션 id 가 가장 작은 그룹의 코디네이터에게 참가 요청
    let best: { peerId: string; session: string; members: MemberInfo[] } | null = null;
    for (const [peerId, c] of this.candidates) if (!best || c.session < best.session) best = { peerId, ...c };
    if (!best) return;
    // 코디네이터 = 활성 멤버 중 최소 pid
    let coord: MemberInfo | null = null;
    for (const mm of best.members) if (mm.leaveTick < 0 && (!coord || mm.pid < coord.pid)) coord = mm;
    const target = coord ? coord.peerId : best.peerId;
    this.resetToJoin(target);
    // 코디네이터와 아직 연결이 안 됐으면 onPeerJoin 에서 재전송
  }

  /** 코디네이터: 참가 승인 */
  private admit(peerId: string, name: string): void {
    if (!this.world) return;
    if (this.peerToPid.has(peerId)) {
      // 이미 멤버 (재요청) → 다시 알려주기만
      const pid = this.peerToPid.get(peerId)!;
      const m = this.members.get(pid)!;
      this.transport.sendControl({ t: 'join', pid, peerId, name: m.name, team: -1, atTick: m.joinTick, session: this.session }, peerId);
      return;
    }
    let pid = this.world.nextPlayerId;
    for (const m of this.members.values()) if (m.pid >= pid) pid = m.pid + 1;
    const atTick = this.latestSent + 1;
    const team = this.pickTeamWithPending();
    const msg: ControlMsg = { t: 'join', pid, peerId, name, team, atTick, session: this.session };
    this.members.set(pid, { pid, peerId, name, joinTick: atTick, leaveTick: -1 });
    this.peerToPid.set(peerId, pid);
    this.transport.sendControl(msg); // 모두에게 (참가자 포함)
    this.pendingSnaps.push({ peerId, tick: atTick });
    this.log(`admit ${name} pid=${pid} at tick ${atTick}`);
  }

  private pickTeamWithPending(): number {
    if (!this.world) return 0;
    const count = [0, 0];
    for (const p of this.world.players) count[p.team]++;
    return count[0] <= count[1] ? 0 : 1;
  }

  // ---------- 이탈 절차 ----------
  private startLeave(pid: number): void {
    const qid = this.nextQid++;
    this.leaveQueries.set(qid, { pid, deadline: this.lastNow + LEAVE_QUERY_MS, replies: new Map() });
    this.transport.sendControl({ t: 'leaveq', pid, qid });
    this.log(`leave query for pid ${pid}`);
  }

  private finishLeave(qid: number): void {
    const q = this.leaveQueries.get(qid);
    if (!q) return;
    this.leaveQueries.delete(qid);
    const m = this.members.get(q.pid);
    if (!m || m.leaveTick >= 0) return;
    const hist = this.inputs.get(q.pid);
    let last = -1;
    if (hist) for (const t of hist.keys()) if (t > last) last = t;
    for (const r of q.replies.values()) if (r.lastTick > last) last = r.lastTick;
    const atTick = Math.max(last + 1, this.latestSent + 1, m.joinTick);
    const r = this.packRange(q.pid, Math.max(m.joinTick, last - 120), last);
    this.transport.sendControl({ t: 'leave', pid: q.pid, atTick, fromTick: r.start, inputsB64: b64(r.bytes) });
    this.applyLeave(q.pid, atTick, r.start, r.bytes);
  }

  private pendingLeaves = new Map<number, { atTick: number; fromTick: number; bytes: Uint8Array }>();

  private applyLeave(pid: number, atTick: number, fromTick: number, bytes: Uint8Array): void {
    const m = this.members.get(pid);
    if (!m) { this.pendingLeaves.set(pid, { atTick, fromTick, bytes }); return; }
    if (m.leaveTick >= 0) return;
    // 제공된 입력과 내 기록이 이미 시뮬한 구간에서 다르면 → 재동기화
    let diverged = false;
    const hist = this.inputs.get(pid) ?? new Map<number, Input>();
    const provided = this.unpackInputs(bytes);
    const simTick = this.world?.tick ?? 0;
    for (let i = 0; i < provided.length; i++) {
      const t = fromTick + i;
      const mine = hist.get(t);
      if (t < simTick && mine && !inputEquals(mine, provided[i])) diverged = true;
      hist.set(t, provided[i]);
    }
    const last = fromTick + provided.length - 1;
    for (let t = last + 1; t < atTick; t++) {
      const mine = hist.get(t);
      if (t < simTick && mine && !inputEquals(mine, EMPTY_INPUT)) diverged = true;
      hist.set(t, { ...EMPTY_INPUT });
    }
    for (const t of [...hist.keys()]) if (t >= atTick) hist.delete(t);
    this.inputs.set(pid, hist);
    m.leaveTick = atTick;
    for (const map of this.hashes.values()) map.delete(pid); // 떠난 피어의 (앞서간) 해시는 비교 대상에서 제외
    this.log(`pid ${pid} leaves at tick ${atTick}${diverged ? ' (diverged → resync)' : ''}`);
    this.message = tr('left', { name: m.name });
    if (diverged && pid !== this.pid) this.requestResync();
  }

  // ---------- 입력 ----------
  private storeInputs(pid: number, fromTick: number, bytes: Uint8Array): void {
    let hist = this.inputs.get(pid);
    if (!hist) { hist = new Map(); this.inputs.set(pid, hist); }
    const m = this.members.get(pid);
    const n = (bytes.length / INPUT_BYTES) | 0;
    for (let i = 0; i < n; i++) {
      const t = fromTick + i;
      if (m && m.leaveTick >= 0 && t >= m.leaveTick) continue;
      if (!hist.has(t)) hist.set(t, decodeInput(bytes, i * INPUT_BYTES));
    }
  }

  /** 히스토리에서 [from,to] 의 연속 구간을 꺼낸다 (헤더 없음). */
  private packRange(pid: number, from: number, to: number): { start: number; bytes: Uint8Array } {
    const hist = this.inputs.get(pid);
    const list: Input[] = [];
    let start = from;
    if (hist) {
      while (start <= to && !hist.has(start)) start++;
      for (let t = start; t <= to; t++) {
        const i = hist.get(t);
        if (!i) break;
        list.push(i);
      }
    }
    const bytes = new Uint8Array(list.length * INPUT_BYTES);
    for (let i = 0; i < list.length; i++) encodeInput(list[i], bytes, i * INPUT_BYTES);
    return { start, bytes };
  }
  /** 전송용: [pid i32][fromTick i32][count u16][inputs] */
  private packInputs(pid: number, from: number, to: number): Uint8Array {
    const r = this.packRange(pid, from, to);
    const out = new Uint8Array(10 + r.bytes.length);
    const v = new DataView(out.buffer);
    v.setInt32(0, pid, true); v.setInt32(4, r.start, true); v.setUint16(8, r.bytes.length / INPUT_BYTES, true);
    out.set(r.bytes, 10);
    return out;
  }
  private unpackInputs(bytes: Uint8Array): Input[] {
    const out: Input[] = [];
    const n = (bytes.length / INPUT_BYTES) | 0;
    for (let i = 0; i < n; i++) out.push(decodeInput(bytes, i * INPUT_BYTES));
    return out;
  }

  private onInputs(bytes: Uint8Array, _from: string): void {
    if (bytes.length < 10) return;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pid = v.getInt32(0, true), from = v.getInt32(4, true), n = v.getUint16(8, true);
    if (pid === this.pid) return;
    this.storeInputs(pid, from, bytes.subarray(10, 10 + n * INPUT_BYTES));
  }

  /** 로컬 입력을 틱 케이던스에 맞춰 발행 */
  /** 이번 호출에서 발행한 입력 틱 수 (호출자가 1회성 입력을 래치 해제하는 데 사용) */
  emittedLast = 0;

  private emitInputs(now: number, local: Input): void {
    this.emittedLast = 0;
    if (this.pid === 0) return;
    const base = this.world ? this.world.tick : this.waitingSnapAt;
    this.tickAcc += now - this.lastNow;
    let emitted = 0;
    while (this.tickAcc >= TICK_MS && emitted < 4) {
      this.tickAcc -= TICK_MS;
      if (this.localTick > base + INPUT_DELAY + MAX_AHEAD) { this.tickAcc = 0; break; }
      let hist = this.inputs.get(this.pid);
      if (!hist) { hist = new Map(); this.inputs.set(this.pid, hist); }
      // 참가/재동기화 대기 중이면 빈 입력
      const inp = this.world && this.phase === 'playing' ? { ...local } : { ...EMPTY_INPUT };
      hist.set(this.localTick, inp);
      const bytes = new Uint8Array(10 + INPUT_BYTES * 2);
      const v = new DataView(bytes.buffer);
      const from = Math.max(0, this.localTick - 1);
      const cnt = this.localTick - from + 1;
      v.setInt32(0, this.pid, true); v.setInt32(4, from, true); v.setUint16(8, cnt, true);
      for (let i = 0; i < cnt; i++) encodeInput(hist.get(from + i) ?? EMPTY_INPUT, bytes, 10 + i * INPUT_BYTES);
      this.transport.sendInputs(bytes.subarray(0, 10 + cnt * INPUT_BYTES));
      this.latestSent = this.localTick;
      this.localTick++;
      emitted++;
      this.emittedLast = emitted;
    }
    if (this.tickAcc > TICK_MS * 4) this.tickAcc = TICK_MS * 4;
  }

  // ---------- 스냅샷 ----------
  private onSnapshot(bytes: Uint8Array, _from: string): void {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tick = v.getInt32(0, true);
    const jlen = v.getInt32(4, true);
    const json = new TextDecoder().decode(bytes.subarray(8, 8 + jlen));
    const members = JSON.parse(json) as MemberInfo[];
    if (this.phase !== 'joining' && this.phase !== 'resync') return;
    if (tick !== this.waitingSnapAt) { this.log(`snapshot tick ${tick} != expected ${this.waitingSnapAt}`); }
    this.world = deserializeWorld(bytes.subarray(8 + jlen));
    // 스냅샷 이후에 공표된 참가/이탈은 유지하고, 나머지는 스냅샷 기준으로 교체
    const later = [...this.members.values()].filter((m) => m.joinTick >= tick || m.leaveTick >= tick);
    this.members.clear(); this.peerToPid.clear();
    for (const m of members) { this.members.set(m.pid, { ...m }); this.peerToPid.set(m.peerId, m.pid); }
    for (const m of later) {
      const ex = this.members.get(m.pid);
      if (!ex) { this.members.set(m.pid, { ...m }); this.peerToPid.set(m.peerId, m.pid); }
      else if (m.leaveTick >= tick && ex.leaveTick < 0) ex.leaveTick = m.leaveTick;
    }
    // 스냅샷 이전 입력은 버림
    for (const hist of this.inputs.values()) for (const t of [...hist.keys()]) if (t < tick) hist.delete(t);
    this.hashes.clear();
    this.phase = 'playing';
    for (const [pid, pl] of this.pendingLeaves) if (this.members.has(pid)) this.applyLeave(pid, pl.atTick, pl.fromTick, pl.bytes);
    this.pendingLeaves.clear();
    this.waitingSnapAt = -1;
    this.stallSince = 0;
    this.message = tr('synced', { tick });
    this.log(`snapshot installed at tick ${tick}, ${this.world.players.length} players`);
  }

  private requestResync(): void {
    if (this.phase !== 'playing') return;
    const coord = this.coordinatorPeer();
    if (!coord || coord === this.transport.selfId) return;
    if (!this.transport.peers().includes(coord)) { this.log('resync needed but coordinator not connected; waiting'); return; }
    this.desyncs++;
    this.phase = 'resync';
    this.waitingSnapAt = -1;
    this.message = tr('desyncDetected');
    this.transport.sendControl({ t: 'snapreq' }, coord);
  }

  private flushPendingSnaps(tick: number): void {
    if (!this.world || this.pendingSnaps.length === 0) return;
    const due = this.pendingSnaps.filter((s) => s.tick === tick);
    if (due.length === 0) return;
    this.pendingSnaps = this.pendingSnaps.filter((s) => s.tick > tick);
    const worldBytes = serializeWorld(this.world);
    const json = new TextEncoder().encode(JSON.stringify([...this.members.values()]));
    const out = new Uint8Array(8 + json.length + worldBytes.length);
    const v = new DataView(out.buffer);
    v.setInt32(0, tick, true); v.setInt32(4, json.length, true);
    out.set(json, 8); out.set(worldBytes, 8 + json.length);
    for (const s of due) this.transport.sendSnapshot(out, s.peerId);
    this.log(`snapshot sent for tick ${tick} (${out.length} bytes) to ${due.length}`);
  }

  // ---------- 해시 ----------
  private checkHashes(tick: number): void {
    const map = this.hashes.get(tick);
    if (!map || !this.world) return;
    const mine = map.get(this.pid);
    const coord = this.coordinatorPid(tick);
    const ch = map.get(coord);
    if (mine !== undefined && ch !== undefined && mine !== ch && coord !== this.pid) {
      this.log(`hash mismatch at tick ${tick}: mine=${mine} coord=${ch}`);
      this.requestResync();
    }
    for (const t of [...this.hashes.keys()]) if (t < tick - HASH_INTERVAL * 5) this.hashes.delete(t);
  }

  // ---------- 메인 갱신 ----------
  update(now: number, local: Input): void {
    // 탐색 단계: 기존 세션이 없으면 창립
    if (this.phase === 'discover') {
      if (this.candidates.size > 0) this.tryJoinCandidate();
      else if (now - this.startedAt > DISCOVER_MS) this.becomeFounder();
      this.lastNow = now;
      return;
    }
    // 이탈 질의 마감
    for (const [qid, q] of this.leaveQueries) if (now >= q.deadline) this.finishLeave(qid);

    this.emitInputs(now, local);
    this.lastNow = now;

    if (!this.world || this.phase !== 'playing') return;

    // 시뮬레이션 진행
    let steps = 0;
    while (steps < MAX_STEPS_PER_FRAME) {
      const t = this.world.tick;
      const frame = this.buildFrame(t);
      if (!frame) break;
      this.flushPendingSnaps(t);
      this.world.step(frame);
      steps++;
      if (this.world.tick % HASH_INTERVAL === 0) {
        const h = hashWorld(this.world);
        let map = this.hashes.get(this.world.tick);
        if (!map) { map = new Map(); this.hashes.set(this.world.tick, map); }
        map.set(this.pid, h);
        this.transport.sendControl({ t: 'hash', tick: this.world.tick, hash: h });
        this.checkHashes(this.world.tick);
      }
    }
    if (steps > 0) {
      this.stallSince = 0;
      this.pruneHistory();
    } else {
      if (!this.stallSince) this.stallSince = now;
      this.handleStall(now);
    }
  }

  private buildFrame(t: number): TickFrame | null {
    const inputs = new Map<number, Input>();
    const joins: JoinEvent[] = [];
    const leaves: number[] = [];
    for (const m of this.members.values()) {
      if (m.joinTick === t) joins.push({ pid: m.pid, name: m.name, team: -1 });
      if (m.leaveTick === t) leaves.push(m.pid);
      if (m.joinTick <= t && (m.leaveTick < 0 || t < m.leaveTick)) {
        const inp = this.inputs.get(m.pid)?.get(t);
        if (!inp) return null;
        inputs.set(m.pid, inp);
      }
    }
    // 참가 이벤트의 팀은 코디네이터가 공표한 값이 아닌, 월드가 결정론적으로 배정(-1 → 자동)
    return { inputs, joins, leaves };
  }

  private handleStall(now: number): void {
    if (!this.world) return;
    const t = this.world.tick;
    const waited = now - this.stallSince;
    for (const m of this.activeMembers(t)) {
      if (m.pid === this.pid) continue;
      if (this.inputs.get(m.pid)?.has(t)) continue;
      // 입력 재요청
      if (waited > STALL_REQ_MS && now - this.lastReqAt > STALL_REQ_MS) {
        this.lastReqAt = now;
        const targets = this.transport.peers();
        if (targets.length) this.transport.sendControl({ t: 'req', pid: m.pid, from: t, to: t + 60 }, targets);
      }
      // 장기 무응답 → 연결된 멤버 중 최소 pid 가 이탈 처리
      const connected = new Set(this.transport.peers());
      const stillConnected = connected.has(m.peerId);
      const kickAfter = stillConnected ? STALL_KICK_MS : STALL_KICK_MS / 4;
      if (waited > kickAfter) {
        let minConnectedPid = this.pid;
        for (const o of this.activeMembers(t)) if (o.pid !== m.pid && connected.has(o.peerId) && o.pid < minConnectedPid) minConnectedPid = o.pid;
        const already = [...this.leaveQueries.values()].some((q) => q.pid === m.pid);
        const lastCheck = this.lastStallKickCheck.get(m.pid) ?? 0;
        if (minConnectedPid === this.pid && !already && now - lastCheck > STALL_KICK_MS) {
          this.lastStallKickCheck.set(m.pid, now);
          this.log(`stalled on pid ${m.pid} for ${waited | 0}ms → leave procedure`);
          this.startLeave(m.pid);
        }
      }
    }
    this.message = waited > 1500 ? tr('waitingFor', { s: (waited / 1000) | 0 }) : this.message;
  }

  private pruneHistory(): void {
    if (!this.world) return;
    const cutoff = this.world.tick - HISTORY_TICKS;
    if (cutoff <= 0 || this.world.tick % 60 !== 0) return;
    for (const hist of this.inputs.values()) for (const t of hist.keys()) if (t < cutoff) hist.delete(t);
  }

  sendChat(text: string): void {
    const t = text.slice(0, 120);
    this.transport.sendControl({ t: 'chat', text: t });
    if (this.onChat) this.onChat(this.pid, this.name, t);
  }

  leave(): void {
    this.transport.sendControl({ t: 'bye' });
    this.transport.leave();
  }
}
