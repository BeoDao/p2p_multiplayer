/**
 * Trystero 기반 WebRTC 풀메시 전송. 시그널링은 공개 릴레이(서버 배포 불필요).
 * 모든 피어가 서로 직접 연결되므로 특정 피어(방장)가 나가도 나머지 연결은 유지된다.
 *
 * 시그널링 전략 선택 (URL 쿼리 또는 생성자 옵션):
 *   ?strategy=nostr (기본, 공개 Nostr 릴레이)  |  ?strategy=torrent (WebTorrent 트래커)
 *   ?relays=wss://a,wss://b  로 릴레이/트래커를 직접 지정 가능 (자체 호스팅 시)
 */
import { joinRoom as joinNostr, getRelaySockets as nostrSockets } from '@trystero-p2p/nostr';
import { joinRoom as joinTorrent, getRelaySockets as torrentSockets } from '@trystero-p2p/torrent';
import { selfId, type Room, type DataPayload } from '@trystero-p2p/core';
import type { Transport, ControlMsg } from './transport';

const APP_ID = 'kag2web-v1';

export interface P2POptions {
  strategy?: 'nostr' | 'torrent';
  relayUrls?: string[];
  password?: string;
  rtcConfig?: RTCConfiguration;
  trickleIce?: boolean;
}

export class TrysteroTransport implements Transport {
  readonly selfId: string = selfId;
  private room: Room;
  private ctl!: { send: (d: DataPayload, o?: { target?: string | string[] }) => Promise<void> };
  private inp!: { send: (d: Uint8Array, o?: { target?: string | string[] }) => Promise<void> };
  private snap!: { send: (d: Uint8Array, o?: { target?: string | string[] }) => Promise<void> };
  private connected = new Set<string>();

  onPeerJoin = (_: string): void => {};
  onPeerLeave = (_: string): void => {};
  onControl = (_m: ControlMsg, _f: string): void => {};
  onInputs = (_b: Uint8Array, _f: string): void => {};
  onSnapshot = (_b: Uint8Array, _f: string): void => {};

  private roomId: string;
  private config: Parameters<typeof joinNostr>[0];
  private reconnecting = false;

  constructor(roomId: string, opts: P2POptions = {}) {
    this.roomId = roomId;
    this.config = {
      appId: APP_ID,
      password: opts.password,
      rtcConfig: opts.rtcConfig,
      trickleIce: opts.trickleIce,
      relayConfig: opts.relayUrls && opts.relayUrls.length ? { urls: opts.relayUrls, redundancy: opts.relayUrls.length } : undefined,
    };
    this.strategy = opts.strategy === 'torrent' ? 'torrent' : 'nostr';
    this.room = this.openRoom();
  }

  /** 연결 실패 복구: 방을 떠났다가 다시 들어간다. 연결돼 있던 피어들에겐 leave→join 으로 보인다 */
  reconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;
    const old = this.room;
    for (const id of [...this.connected]) { this.connected.delete(id); this.onPeerLeave(id); }
    void old.leave().catch(() => {}).finally(() => {
      setTimeout(() => { this.room = this.openRoom(); this.reconnecting = false; }, 500);
    });
  }

  private openRoom(): Room {
    const join = this.strategy === 'torrent' ? joinTorrent : joinNostr;
    const room = join(this.config, this.roomId);
    const ctl = room.makeAction<DataPayload>('ctl');
    const inp = room.makeAction<Uint8Array>('inp');
    const snap = room.makeAction<Uint8Array>('snap');
    this.ctl = ctl; this.inp = inp; this.snap = snap;
    ctl.onMessage = (d, c) => this.onControl(d as unknown as ControlMsg, c.peerId);
    inp.onMessage = (d, c) => this.onInputs(toU8(d), c.peerId);
    snap.onMessage = (d, c) => this.onSnapshot(toU8(d), c.peerId);
    room.onPeerJoin = (id) => { this.connected.add(id); this.onPeerJoin(id); };
    room.onPeerLeave = (id) => { this.connected.delete(id); this.onPeerLeave(id); };
    return room;
  }


  peers(): string[] { return [...this.connected]; }
  relayCounts(): { open: number; total: number } {
    const st = Object.values(this.relayStatus());
    return { open: st.filter((s) => s === WebSocket.OPEN).length, total: st.length };
  }
  /** 디버그: 릴레이 소켓 상태 */
  relayStatus(): Record<string, number> {
    const socks = (this.strategy === 'torrent' ? torrentSockets() : nostrSockets()) as Record<string, WebSocket>;
    const out: Record<string, number> = {};
    for (const [u, s] of Object.entries(socks)) out[u] = s.readyState;
    return out;
  }
  private strategy: 'nostr' | 'torrent';
  sendControl(msg: ControlMsg, target?: string | string[]): void {
    void this.ctl.send(msg as unknown as DataPayload, target ? { target } : undefined).catch(() => {});
  }
  sendInputs(bytes: Uint8Array, target?: string | string[]): void {
    void this.inp.send(bytes, target ? { target } : undefined).catch(() => {});
  }
  sendSnapshot(bytes: Uint8Array, target: string): void {
    void this.snap.send(bytes, { target }).catch(() => {});
  }
  leave(): void { void this.room.leave(); }
}

/** URL 쿼리에서 P2P 옵션 읽기 */
export function p2pOptionsFromUrl(): P2POptions {
  const q = new URLSearchParams(location.search);
  const strategy = q.get('strategy') === 'torrent' ? 'torrent' : 'nostr';
  const relays = q.get('relays');
  const noStun = q.get('nostun') === '1';
  return {
    strategy,
    relayUrls: relays ? relays.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    trickleIce: q.get('trickle') === '1' ? true : undefined,
    rtcConfig: noStun ? { iceServers: [] } : undefined,
  };
}

function toU8(d: unknown): Uint8Array {
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  throw new Error('unexpected payload');
}
