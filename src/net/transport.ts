/**
 * 전송 계층 추상화. 락스텝 로직은 이 인터페이스만 사용한다.
 * - Trystero(WebRTC 풀메시) 구현: p2p.ts
 * - 오프라인 단독 플레이 구현: 피어 없음
 */
export type ControlMsg =
  | { t: 'hello'; name: string }
  | { t: 'state'; pid: number; session: string; tick: number; members: MemberInfo[] }
  | { t: 'joinreq'; name: string }
  | { t: 'join'; pid: number; peerId: string; name: string; team: number; atTick: number; session: string }
  | { t: 'leaveq'; pid: number; qid: number }
  | { t: 'leaver'; pid: number; qid: number; lastTick: number; inputsB64: string; fromTick: number }
  | { t: 'leave'; pid: number; atTick: number; fromTick: number; inputsB64: string }
  | { t: 'snapreq' }
  | { t: 'snapat'; tick: number }
  | { t: 'req'; pid: number; from: number; to: number }
  | { t: 'hash'; tick: number; hash: number }
  | { t: 'full'; max: number }
  | { t: 'bye' }
  | { t: 'chat'; text: string };

export interface MemberInfo {
  pid: number;
  peerId: string;
  name: string;
  joinTick: number;
  leaveTick: number; // -1 = 없음
}

export interface Transport {
  readonly selfId: string;
  peers(): string[];
  sendControl(msg: ControlMsg, target?: string | string[]): void;
  /** 입력 배치: [pid i32][fromTick i32][count u16][4바이트 × count] */
  sendInputs(bytes: Uint8Array, target?: string | string[]): void;
  /** 스냅샷: [tick i32][membersJsonLen i32][membersJson][world bytes] */
  sendSnapshot(bytes: Uint8Array, target: string): void;
  onPeerJoin: (peerId: string) => void;
  onPeerLeave: (peerId: string) => void;
  onControl: (msg: ControlMsg, from: string) => void;
  onInputs: (bytes: Uint8Array, from: string) => void;
  onSnapshot: (bytes: Uint8Array, from: string) => void;
  leave(): void;
  /** 선택: 시그널링 릴레이 상태 (열린 소켓 수, 전체 수) */
  relayCounts?(): { open: number; total: number };
  /** 선택: 방을 나갔다가 다시 들어가 모든 피어 연결을 새로 맺는다 (연결 실패 복구) */
  reconnect?(): void;
}

/** 피어가 없는 로컬 전송 (싱글플레이/테스트) */
export class LocalTransport implements Transport {
  selfId = 'local';
  onPeerJoin = (_: string): void => {};
  onPeerLeave = (_: string): void => {};
  onControl = (_m: ControlMsg, _f: string): void => {};
  onInputs = (_b: Uint8Array, _f: string): void => {};
  onSnapshot = (_b: Uint8Array, _f: string): void => {};
  peers(): string[] { return []; }
  sendControl(): void {}
  sendInputs(): void {}
  sendSnapshot(): void {}
  leave(): void {}
}
