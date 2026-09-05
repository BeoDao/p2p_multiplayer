import type { Input } from './input';

export const TICK_RATE = 30;

export const TEAM_BLUE = 0;
export const TEAM_RED = 1;

export const enum PlayerState {
  Dead = 0,
  Alive = 1,
}

export interface Player {
  id: number; // 시뮬 내부 플레이어 id (1부터, 코디네이터가 순차 배정)
  name: string;
  team: number;
  cls: number; // classes.json id
  state: PlayerState;
  respawnAt: number; // 부활 틱
  // 위치/속도 (FP). x,y 는 AABB 좌상단
  x: number; y: number; vx: number; vy: number;
  onGround: boolean;
  onLadder: boolean;
  inWater: boolean;
  breath: number; // 남은 숨 (틱)
  facing: number; // -1 | 1
  aimX: number; aimY: number; // 커서 오프셋(px, 입력 그대로)
  hp: number;
  // 무기 상태
  slot: number;
  attackTimer: number; // 남은 쿨다운
  attackWindup: number; // 휘두름 진행 (0=없음)
  charge: number; // 활 당김 틱
  shield: boolean;
  bombs: number;
  arrows: number;
  // 자원
  wood: number; stone: number; gold: number;
  // 깃발 소지 여부 (팀 id 또는 -1)
  carryingFlag: number;
  kills: number; deaths: number;
  lastInput: Input;
  hurtTimer: number; // 피격 무적/연출
  animEvent: number; // 렌더러용 이벤트 카운터(공격 시작 등) — 상태의 일부이므로 결정론적
  digCheat: number; // [DEV] 1 이면 타일 즉사 (CHEATS_ENABLED)
  digMode: number; // 곡괭이 홀드 모드: 0 없음, 1 앞 타일, 2 뒷벽 (누른 순간 결정, 실수로 뒷벽까지 파지 않게)
}

export const enum ProjKind {
  Arrow = 0,
  Bomb = 1,
}

export interface Projectile {
  id: number;
  kind: ProjKind;
  owner: number;
  team: number;
  x: number; y: number; vx: number; vy: number; // FP, 중심
  timer: number; // 화살: 수명 / 폭탄: 퓨즈
  damage: number;
  stuck: boolean;
}

/** 바닥에 떨어진 아이템 (자원 뭉치, 폭탄, 화살). 겹치면 줍는다 */
export const DropKind = { Wood: 0, Stone: 1, Gold: 2, Bombs: 3, Arrows: 4 } as const;
export interface Drop {
  id: number;
  kind: number; // DropKind
  amount: number;
  x: number; y: number; vx: number; vy: number; // FP, 중심
  life: number; // 남은 틱
}

export interface Flag {
  team: number;
  homeX: number; homeY: number; // 타일 좌표
  x: number; y: number; // FP 중심 (땅에 있을 때)
  carrier: number; // 소지 플레이어 id 또는 0
  atHome: boolean;
  returnTimer: number; // 떨어진 후 자동 복귀
}

export interface WorldEvent {
  kind: 'hit' | 'die' | 'explode' | 'dig' | 'build' | 'capture' | 'shoot' | 'slash' | 'pickup' | 'buy' | 'jump' | 'loot';
  x: number; y: number; // FP
  player?: number;
  team?: number;
  tile?: number;
  by?: number; // 가해자 pid (die)
}
