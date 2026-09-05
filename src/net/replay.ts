/**
 * 리플레이 = 맵 시드(또는 시작 스냅샷) + 틱별 프레임(참가/이탈/입력) + 주기 해시.
 * 시뮬이 결정론적이므로 이것만으로 경기를 완전히 재현하고, 재생 중 기록된 해시와 비교해 재현이 정확한지 검증한다.
 *
 * 파일 포맷 (.rwr, 리틀엔디언):
 *   'RWR2' i32 | fmt u8 | room str | seed i32 | startTick i32 | hasSnapshot u8 | [snapshot bytes] |
 *   레코드 반복: kind u8 (0 = 프레임, 1 = 해시)
 *     프레임: tick i32 | nJoins u8 { pid i32, team u8, name str } | nLeaves u8 { pid i32 } | nInputs u8 { pid i32, input }
 *     해시:   tick i32 | hash i32
 *   트레일러: kind u8 = 2 | check i32  — 앞부분 전체의 무결성 체크섬(FNV-1a, 솔트 포함)
 *
 * 무결성에 대해: 체크섬과 60틱 해시는 "손상/단순 편집" 을 잡는다. 클라이언트 코드는 공개돼 있으므로
 * 마음먹은 조작(체크섬·해시까지 다시 계산)은 클라이언트만으로는 막을 수 없다 — 그건 서버(릴레이)가 파일 해시에 서명해야 한다.
 */
import { fnv1a } from '../sim/rng';
import { Writer, Reader } from '../sim/schema';
import { INPUT_SCHEMA, serializeWorld, deserializeWorld } from '../sim/serialize';
import type { Input } from '../sim/input';
import type { World, TickFrame, JoinEvent } from '../sim/world';

const MAGIC = 0x52575232; // 'RWR2'
const FORMAT = 2;
const SALT = new TextEncoder().encode('rubblewar-replay-v2');
const REBASE_TICKS = 30 * 60 * 10; // 10분마다 스냅샷으로 다시 시작 (메모리 상한)

export interface Replay {
  room: string;
  seed: number;
  startTick: number;
  snapshot: Uint8Array | null;
  frames: Map<number, TickFrame>;
  hashes: Map<number, number>;
  endTick: number;
}

export class ReplayRecorder {
  private header: Uint8Array | null = null;
  private body = new Writer(1 << 16);
  private startTick = 0;
  private room = '';
  frames = 0;

  /** 월드가 생기거나(창립) 스냅샷이 설치될 때 호출 */
  start(world: World, room: string): void {
    this.room = room;
    this.startTick = world.tick;
    this.frames = 0;
    const w = new Writer(4096);
    w.i32(MAGIC); w.u8(FORMAT); w.str(room); w.i32(world.seed); w.i32(world.tick);
    if (world.tick === 0) w.u8(0);
    else { w.u8(1); w.bytes(serializeWorld(world)); }
    this.header = w.done();
    this.body = new Writer(1 << 16);
  }

  record(world: World, frame: TickFrame): void {
    if (!this.header) return;
    // 메모리 상한: 오래되면 현재 상태 스냅샷으로 다시 시작
    if (world.tick - this.startTick >= REBASE_TICKS) this.start(world, this.room);
    const w = this.body;
    w.u8(0); w.i32(world.tick);
    w.u8(frame.joins.length);
    for (const j of frame.joins) { w.i32(j.pid); w.u8(j.team & 0xff); w.str(j.name); }
    w.u8(frame.leaves.length);
    for (const pid of frame.leaves) w.i32(pid);
    const pids = [...frame.inputs.keys()].sort((a, b) => a - b);
    w.u8(pids.length);
    for (const pid of pids) { w.i32(pid); w.obj(INPUT_SCHEMA, frame.inputs.get(pid)!); }
    this.frames++;
  }

  recordHash(tick: number, hash: number): void {
    if (!this.header) return;
    this.body.u8(1); this.body.i32(tick); this.body.i32(hash);
  }

  get active(): boolean { return this.header !== null; }

  export(): Uint8Array {
    if (!this.header) return new Uint8Array();
    const b = this.body.done();
    const out = new Uint8Array(this.header.length + b.length + 5);
    out.set(this.header); out.set(b, this.header.length);
    const n = this.header.length + b.length;
    out[n] = 2;
    new DataView(out.buffer).setInt32(n + 1, checksum(out.subarray(0, n)) | 0, true);
    return out;
  }
}

function checksum(data: Uint8Array): number {
  const buf = new Uint8Array(data.length + SALT.length);
  buf.set(SALT); buf.set(data, SALT.length);
  return fnv1a(buf);
}

export function parseReplay(bytes: Uint8Array): Replay {
  if (bytes.length < 10) throw new Error('not a replay file');
  const r = new Reader(bytes);
  if (r.i32() !== MAGIC) throw new Error('not a replay file (or an older format)');
  if (r.u8() !== FORMAT) throw new Error('unsupported replay format');
  // 트레일러 검증
  const n = bytes.length - 5;
  if (bytes[n] !== 2 || (new DataView(bytes.buffer, bytes.byteOffset).getInt32(n + 1, true) | 0) !== (checksum(bytes.subarray(0, n)) | 0)) throw new Error('replay file is corrupted or was modified');
  const room = r.str(), seed = r.i32(), startTick = r.i32();
  const snapshot = r.u8() ? r.bytes() : null;
  const frames = new Map<number, TickFrame>();
  const hashes = new Map<number, number>();
  let endTick = startTick;
  while (r.remaining > 5) {
    const kind = r.u8();
    if (kind === 1) { const t = r.i32(); hashes.set(t, r.i32() >>> 0); continue; } // 해시는 부호 없는 32비트
    const tick = r.i32();
    const joins: JoinEvent[] = [];
    const nj = r.u8();
    for (let i = 0; i < nj; i++) { const pid = r.i32(); const team = r.u8(); joins.push({ pid, name: r.str(), team: team === 255 ? -1 : team }); }
    const leaves: number[] = [];
    const nl = r.u8();
    for (let i = 0; i < nl; i++) leaves.push(r.i32());
    const inputs = new Map<number, Input>();
    const ni = r.u8();
    for (let i = 0; i < ni; i++) { const pid = r.i32(); inputs.set(pid, r.obj<Input>(INPUT_SCHEMA)); }
    frames.set(tick, { joins, leaves, inputs });
    endTick = Math.max(endTick, tick + 1);
  }
  return { room, seed, startTick, snapshot, frames, hashes, endTick };
}

/** 리플레이 시작 상태의 월드 */
export function replayWorld(rep: Replay, makeWorld: (seed: number) => World): World {
  return rep.snapshot ? deserializeWorld(rep.snapshot) : makeWorld(rep.seed);
}

export function replayFileName(room: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `rubblewar-${room || 'offline'}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.rwr`;
}
