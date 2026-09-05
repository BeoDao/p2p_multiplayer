/**
 * 월드 시뮬레이션. 완전 결정론적: 같은 초기 상태 + 같은 입력 열 → 같은 결과.
 * 부동소수점, Date, Math.random, 객체 키 순서 의존 모두 금지.
 */
import {
  FP_ONE, TILE_FP, TILE_SHIFT, px, toTile, clamp, iabs, isign, imin, imax, vnorm, vlen, aabbOverlap, idiv,
} from './fixed';
import { Rng } from './rng';
import { spawnVehicle, handleMount, updateRider, updateVehicles, dismount, damageVehicle, vehicleDef, nearestMountable } from './vehicle';
import { TileMap, NO_TEAM, WATER_MAX, generateMap } from './tilemap';
import {
  CLASSES, TILE_TABLE, T_AIR, T_TRUNK, hotbarItem, tileId, RESOURCE_KINDS, type ClassDef, type ResourceKind, type TileDef,
} from '../data/defs';
import {
  BTN_LEFT, BTN_RIGHT, BTN_UP, BTN_DOWN, BTN_JUMP, BTN_ACTION1, BTN_ACTION2, BTN_USE, EMPTY_INPUT, type Input,
} from './input';
import {
  PlayerState, ProjKind, type Player, type Projectile, type Flag, type Drop, DropKind, type Vehicle, type WorldEvent, TEAM_BLUE, TEAM_RED,
} from './types';

export interface JoinEvent { pid: number; name: string; team: number }
export interface TickFrame {
  inputs: Map<number, Input>; // pid → input (없으면 EMPTY)
  joins: JoinEvent[];
  leaves: number[];
}

// 튜닝 상수 (FP)
const GRAVITY = 190;
const MAX_FALL = 2300;
const ACCEL_GROUND = 140;
const ACCEL_AIR = 70;
const FRICTION_GROUND = 120;
const FRICTION_AIR = 20;
const LADDER_SPEED = 500;
const RESPAWN_TICKS = 120;
const FLAG_RETURN_TICKS = 450;
const WIN_SCORE = 3;
const ROUND_RESET_TICKS = 240;
// 투척 게이지 (폭탄 등 모든 투척 무기 공통): 누른 틱 수에 비례해 속도 결정
export const THROW_CHARGE_TICKS = 20;
const THROW_MIN_SPEED = 500;
const THROW_MAX_SPEED = 1900;
const ARROW_LIFE = 240;
const STUCK_ARROW_LIFE = 150;
const HURT_TICKS = 8;
const DROP_LIFE = 1800; // 60초
const BREATH_TICKS = 300; // 10초
const WATER_STEP_INTERVAL = 2;
const MAX_DROPS = 256; // 드롭 상한 (초과 시 가장 오래된 것 제거)
const DROP_PICKUP_DELAY = 20; // 떨어뜨린 직후 되줍기 방지
const MAX_STEP = 900;
const JUMP_HOLD_TICKS = 8; // 가변 점프 추가 상승 틱 수 // 서브스텝 최대 이동 (< 반 타일)
/** [DEV] 치트 처리 스위치. 치트는 ` 콘솔(dev/cheats.ts)에서만 발생하며 입력으로 전달되므로 모든 피어에서 동일하게 적용된다. 출시 전 false. */
export const CHEATS_ENABLED = true;
const COLLAPSE_SEARCH_LIMIT = 2500; // 이보다 큰 덩어리는 안정으로 간주
const COLLAPSE_TICKS_PER_STEP = 2; // 붕괴 전파 속도 (BFS 거리당 틱)

export class World {
  readonly seed: number;
  rng: Rng;
  map: TileMap;
  players: Player[] = []; // id 오름차순 유지
  projectiles: Projectile[] = [];
  flags: Flag[] = [];
  drops: Drop[] = [];
  nextDropId = 1;
  vehicles: Vehicle[] = [];
  nextVehicleId = 1;
  vehicleRespawnAt: number[] = [0, 0];
  nextDummyId = 900; // [DEV] 더미 봇 pid
  score: Int32Array = new Int32Array(2);
  nextPlayerId = 1;
  nextProjId = 1;
  tick = 0;
  round = 1;
  roundOverAt = 0; // 0 = 진행중
  spawnX: number[] = [0, 0];
  /** 예정된 붕괴: [cellIndex, atTick] 쌍 (상태의 일부, 직렬화됨) */
  collapses: number[] = [];
  /** 렌더러용 이벤트(매 틱 초기화, 상태 아님) */
  events: WorldEvent[] = [];

  constructor(seed: number, w = 224, h = 96) {
    this.seed = seed | 0;
    this.rng = new Rng(seed);
    this.map = new TileMap(w, h);
    this.buildMap();
  }

  private buildMap(): void {
    const { spawnX, groundY } = generateMap(this.map, this.rng);
    this.spawnX = spawnX;
    this.flags = [TEAM_BLUE, TEAM_RED].map((team) => {
      const tx = spawnX[team] + (team === TEAM_BLUE ? 4 : -4);
      const ty = groundY[tx] - 1;
      const f: Flag = {
        team, homeX: tx, homeY: ty,
        x: (tx << TILE_SHIFT) + TILE_FP / 2, y: (ty << TILE_SHIFT) + TILE_FP / 2,
        carrier: 0, atHome: true, returnTimer: 0,
      };
      return f;
    });
    this.vehicles = [];
    this.vehicleRespawnAt = [0, 0];
    spawnVehicle(this, TEAM_BLUE);
    spawnVehicle(this, TEAM_RED);
  }

  // ---------- 플레이어 관리 ----------
  getPlayer(id: number): Player | undefined {
    // 이진 탐색 (정렬 유지)
    let lo = 0, hi = this.players.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const p = this.players[mid];
      if (p.id === id) return p;
      if (p.id < id) lo = mid + 1; else hi = mid - 1;
    }
    return undefined;
  }

  /** 팀 자동 배정: 인원 적은 팀, 같으면 파랑 */
  pickTeam(): number {
    let b = 0, r = 0;
    for (const p of this.players) (p.team === TEAM_BLUE ? b++ : r++);
    return b <= r ? TEAM_BLUE : TEAM_RED;
  }

  addPlayer(pid: number, name: string, team: number): Player {
    if (this.getPlayer(pid)) return this.getPlayer(pid)!;
    if (team !== TEAM_BLUE && team !== TEAM_RED) team = this.pickTeam();
    const cls = CLASSES[0];
    const p: Player = {
      id: pid, name, team, cls: cls.id, state: PlayerState.Dead, respawnAt: this.tick,
      x: 0, y: 0, vx: 0, vy: 0, onGround: false, onLadder: false, inWater: false, breath: BREATH_TICKS, facing: team === TEAM_BLUE ? 1 : -1,
      aimX: 0, aimY: 0, hp: 0, slot: 0, attackTimer: 0, attackWindup: 0, charge: 0, shield: false,
      bombs: 0, arrows: 0, wood: 0, stone: 0, gold: 0, carryingFlag: -1, kills: 0, deaths: 0,
      lastInput: { ...EMPTY_INPUT }, hurtTimer: 0, animEvent: 0, digMode: 0, digCheat: 0, vehicle: 0, god: 0, jumpTicks: 0,
    };
    // 정렬 삽입
    let i = this.players.length;
    while (i > 0 && this.players[i - 1].id > pid) i--;
    this.players.splice(i, 0, p);
    if (pid >= this.nextPlayerId) this.nextPlayerId = pid + 1;
    return p;
  }

  removePlayer(pid: number): void {
    const idx = this.players.findIndex((p) => p.id === pid);
    if (idx < 0) return;
    const p = this.players[idx];
    this.dropFlag(p);
    this.players.splice(idx, 1);
  }

  private spawn(p: Player): void {
    const cls = CLASSES[p.cls];
    const tx = this.spawnX[p.team] + this.rng.range(-3, 3);
    // 지표면 찾기
    let ty = 0;
    while (ty < this.map.h - 1 && !this.map.isSolid(tx, ty)) ty++;
    p.x = (tx << TILE_SHIFT) + ((TILE_FP - px(cls.width)) >> 1);
    p.y = (ty << TILE_SHIFT) - px(cls.height);
    p.vx = 0; p.vy = 0;
    p.hp = cls.hp;
    p.state = PlayerState.Alive;
    p.bombs = cls.bombs ?? 0;
    p.arrows = cls.bow?.arrows ?? 0;
    p.attackTimer = 0; p.attackWindup = 0; p.charge = 0; p.shield = false;
    p.carryingFlag = -1;
    p.hurtTimer = 0;
    p.slot = 0;
  }

  // ---------- 메인 스텝 ----------
  step(frame: TickFrame): void {
    this.events.length = 0;
    // 1. 멤버십 변경 (틱 시작 시 결정론적으로 적용)
    for (const j of frame.joins) this.addPlayer(j.pid, j.name, j.team);
    for (const pid of frame.leaves) this.removePlayer(pid);

    // 2. 라운드 종료 처리
    if (this.roundOverAt > 0) {
      if (this.tick >= this.roundOverAt) this.resetRound();
    }

    // 3. 플레이어
    for (const p of this.players) {
      const inp = frame.inputs.get(p.id) ?? EMPTY_INPUT;
      this.updatePlayer(p, inp);
      p.lastInput = inp;
    }
    // 3b. 플레이어끼리 밀치기 (겹치면 서로 반대로 살짝 밀림)
    this.separatePlayers();
    // 3c. 탈것
    updateVehicles(this);
    // 4. 투사체
    this.updateProjectiles();
    // 5. 깃발 / 드롭
    this.updateFlags();
    this.updateDrops();
    // 5b. 물
    if (this.tick % WATER_STEP_INTERVAL === 0) this.map.stepWater(this.tick);
    // 6. 타일 물리: 예정된 붕괴 실행 → 이번 틱에 사라진 칸 주변의 지지 검사
    this.runCollapses();
    this.checkSupport();
    this.tick++;
  }

  private separatePlayers(): void {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (a.state !== PlayerState.Alive || a.vehicle) continue;
      const ca = CLASSES[a.cls];
      const aw = px(ca.width), ah = px(ca.height);
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (b.state !== PlayerState.Alive || b.vehicle) continue;
        const cb = CLASSES[b.cls];
        const bw = px(cb.width), bh = px(cb.height);
        if (!aabbOverlap(a.x, a.y, aw, ah, b.x, b.y, bw, bh)) continue;
        const acx = a.x + (aw >> 1), bcx = b.x + (bw >> 1);
        const dir = acx < bcx ? -1 : acx > bcx ? 1 : (a.id < b.id ? -1 : 1);
        const push = 260;
        a.vx = clamp(a.vx + dir * push, -1500, 1500);
        b.vx = clamp(b.vx - dir * push, -1500, 1500);
      }
    }
  }

  // ---------- 타일 물리 (지지 검사 / 순차 붕괴) ----------
  private runCollapses(): void {
    const c = this.collapses;
    if (c.length === 0) return;
    const keep: number[] = [];
    for (let i = 0; i < c.length; i += 2) {
      const idx = c[i], at = c[i + 1];
      if (at > this.tick) { keep.push(idx, at); continue; }
      const x = idx % this.map.w, y = (idx / this.map.w) | 0;
      const t = this.map.get(x, y);
      if (t !== T_AIR && TILE_TABLE[t].hp > 0) {
        this.map.clearFront(x, y);
        this.events.push({ kind: 'dig', x: (x << TILE_SHIFT) + TILE_FP / 2, y: (y << TILE_SHIFT) + TILE_FP / 2, tile: t });
        // 붕괴로 사라진 drop 타일(쓰러진 나무)은 아이템을 남긴다
        if (TILE_TABLE[t].drop) this.yieldTile(null, TILE_TABLE[t], x, y);
      }
    }
    this.collapses = keep;
  }

  /**
   * 이번 틱에 제거된 칸의 이웃 앞 타일들에 대해 덩어리(BFS)를 구하고, 고정점(bedrock/뒷벽)에 닿지 않으면
   * 제거 지점에서 가까운 순서로 붕괴를 예약한다. 결정론적(정수 BFS, 고정 이웃 순서).
   */
  private checkSupport(): void {
    const map = this.map;
    if (map.removed.length === 0) return;
    const removed = map.removed;
    map.removed = [];
    const w = map.w, h = map.h;
    const visited = new Uint8Array(w * h); // 1 = 이번 검사에서 방문
    const scheduled = new Set<number>();
    for (let i = 0; i < this.collapses.length; i += 2) scheduled.add(this.collapses[i]);
    const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
    for (const ri of removed) {
      const rx = ri % w, ry = (ri / w) | 0;
      // 제거된 칸 자체(뒷벽만 사라진 경우) + 4방향 이웃
      for (let k = -1; k < 4; k++) {
        const sx = k < 0 ? rx : rx + DX[k], sy = k < 0 ? ry : ry + DY[k];
        if (!map.inBounds(sx, sy)) continue;
        const si = sy * w + sx;
        if (visited[si] || map.type[si] === T_AIR || scheduled.has(si)) continue;
        // BFS — 일반 타일끼리 / 나무 파츠끼리만 연결된다
        const tree = map.isTree(sx, sy);
        const isAnchorCell = (x: number, y: number): boolean =>
          tree ? (map.get(x, y) === T_TRUNK && map.isSolid(x, y + 1) && !map.isTree(x, y + 1)) : map.isAnchor(x, y);
        const queue: number[] = [si];
        const dist: number[] = [0];
        visited[si] = 1;
        let anchored = isAnchorCell(sx, sy);
        let head = 0;
        while (head < queue.length && !anchored) {
          const ci = queue[head], cd = dist[head]; head++;
          if (queue.length > COLLAPSE_SEARCH_LIMIT) { anchored = true; break; }
          const cx = ci % w, cy = (ci / w) | 0;
          for (let d = 0; d < 4; d++) {
            const nx = cx + DX[d], ny = cy + DY[d];
            if (!map.inBounds(nx, ny)) continue;
            const ni = ny * w + nx;
            if (visited[ni] || map.type[ni] === T_AIR || map.isTree(nx, ny) !== tree) continue;
            visited[ni] = 1;
            queue.push(ni); dist.push(cd + 1);
            if (isAnchorCell(nx, ny)) anchored = true;
          }
        }
        if (anchored) continue;
        // 고립된 덩어리: 가까운 것부터 순차 붕괴
        for (let q = 0; q < queue.length; q++) {
          if (scheduled.has(queue[q])) continue;
          scheduled.add(queue[q]);
          this.collapses.push(queue[q], this.tick + 1 + dist[q] * COLLAPSE_TICKS_PER_STEP);
        }
      }
    }
  }

  private resetRound(): void {
    this.round++;
    this.roundOverAt = 0;
    this.score[0] = 0; this.score[1] = 0;
    this.rng = new Rng(this.seed + this.round * 7919);
    this.map = new TileMap(this.map.w, this.map.h);
    this.buildMap();
    this.map.dirty.length = 0;
    this.map.dirty.push(-1); // 전체 갱신 신호
    this.projectiles.length = 0;
    this.collapses = [];
    this.map.removed = [];
    this.drops = [];
    for (const p of this.players) {
      p.state = PlayerState.Dead;
      p.respawnAt = this.tick;
      p.wood = 0; p.stone = 0; p.gold = 0;
      p.carryingFlag = -1;
      p.vehicle = 0;
    }
  }

  // ---------- 플레이어 갱신 ----------
  private updatePlayer(p: Player, inp: Input): void {
    const cls = CLASSES[p.cls];
    if (p.state === PlayerState.Dead) {
      if (CHEATS_ENABLED && inp.cheat && (inp.cheat !== p.lastInput.cheat || inp.a0 !== p.lastInput.a0 || inp.a1 !== p.lastInput.a1)) this.applyCheat(p, inp);
      // 죽어 있는 동안 직업 변경 요청 → 부활 시 적용
      if (inp.cls !== 3 && inp.cls < CLASSES.length) p.cls = inp.cls;
      if (this.tick >= p.respawnAt) this.spawn(p);
      return;
    }
    p.aimX = inp.cx; p.aimY = inp.cy;
    if (CHEATS_ENABLED && inp.cheat && (inp.cheat !== p.lastInput.cheat || inp.a0 !== p.lastInput.a0 || inp.a1 !== p.lastInput.a1)) this.applyCheat(p, inp);
    // 탈것 타기/내리기 (E), 운전 중이면 탈것이 위치를 결정한다
    handleMount(this, p, inp);
    if (p.vehicle) { updateRider(this, p, inp); return; }
    if (p.hurtTimer > 0) p.hurtTimer--;
    if (p.attackTimer > 0) p.attackTimer--;

    // 기지에서 직업 변경
    if (inp.cls !== 3 && inp.cls !== p.cls && inp.cls < CLASSES.length && this.inBase(p)) {
      // 제자리에서 직업 변경: 위치 유지, 체력/탄약만 새 직업 기준으로 초기화
      this.dropFlag(p);
      p.cls = inp.cls;
      const ncls = CLASSES[p.cls];
      p.hp = ncls.hp;
      p.bombs = ncls.bombs ?? 0;
      p.arrows = ncls.bow?.arrows ?? 0;
      p.attackTimer = 0; p.attackWindup = 0; p.charge = 0; p.shield = false;
      p.slot = 0;
      p.animEvent++;
      this.events.push({ kind: 'build', x: p.x + px(ncls.width) / 2, y: p.y + px(ncls.height) / 2 });
      return;
    }

    // 슬롯
    const nslot = clamp(inp.slot, 0, cls.hotbar.length - 1);
    if (nslot !== p.slot) { p.slot = nslot; p.charge = 0; }

    const w = px(cls.width), h = px(cls.height);
    const left = (inp.buttons & BTN_LEFT) !== 0;
    const right = (inp.buttons & BTN_RIGHT) !== 0;
    const up = (inp.buttons & BTN_UP) !== 0;
    const down = (inp.buttons & BTN_DOWN) !== 0;
    const jump = (inp.buttons & BTN_JUMP) !== 0;

    // 방패(기사): 우클릭 홀드 시 이동 속도 감소
    p.shield = !!cls.shield && (inp.buttons & BTN_ACTION2) !== 0;
    const speedMul = p.shield ? 2 : 4; // /4
    const runSpeed = idiv(cls.runSpeed * speedMul, 4);

    // 사다리
    const cxT = toTile(p.x + (w >> 1)), cyT = toTile(p.y + (h >> 1));
    const onLadderTile = this.map.isLadder(cxT, cyT) || this.map.isLadder(cxT, toTile(p.y + h - 1));
    p.onLadder = onLadderTile && (up || down || (p.onLadder && !p.onGround));
    // W 는 사다리 위에서는 오르기, 아니면 점프
    const wantJump = jump || (up && !onLadderTile);

    // 수평 이동
    const accel = p.onGround ? ACCEL_GROUND : ACCEL_AIR;
    const fric = p.onGround ? FRICTION_GROUND : FRICTION_AIR;
    if (left !== right) {
      const dir = left ? -1 : 1;
      p.facing = inp.cx !== 0 ? isign(inp.cx) : dir;
      const target = dir * runSpeed;
      if (dir > 0 ? p.vx < target : p.vx > target) p.vx = clamp(p.vx + dir * accel, -runSpeed, runSpeed);
    } else {
      if (inp.cx !== 0) p.facing = isign(inp.cx);
      if (p.vx > 0) p.vx = imax(0, p.vx - fric);
      else if (p.vx < 0) p.vx = imin(0, p.vx + fric);
    }

    // 물: 몸 중심 칸의 수위가 절반 이상이면 수영
    const waterLv = this.map.waterAt(cxT, cyT);
    p.inWater = waterLv >= WATER_MAX / 2;
    const headWater = this.map.waterAt(cxT, toTile(p.y + 512)) >= WATER_MAX / 2;
    if (headWater) {
      if (--p.breath <= 0) { this.hurt(p, 1, 0, 0, 0); p.breath = 30; }
    } else p.breath = BREATH_TICKS;

    // 수직
    if (p.inWater && !p.onLadder) {
      // 수영: 약한 중력 + 감쇠, 점프로 위로 헤엄
      p.vy = imin(p.vy + idiv(GRAVITY, 4), 700);
      p.vy = idiv(p.vy * 15, 16);
      p.vx = idiv(p.vx * 14, 16);
      // 머리가 수면 위면 물 밖으로 완전히 점프할 수 있다 (지형 위로 올라오기); 잠겨 있으면 헤엄쳐 오르기만
      const jumpEdge = wantJump && (p.lastInput.buttons & (BTN_JUMP | BTN_UP)) === 0;
      if (wantJump && !headWater && (jumpEdge || p.vy >= -300)) { p.vy = cls.jumpSpeed; this.events.push({ kind: 'jump', x: p.x, y: p.y, player: p.id }); }
      else if (wantJump) p.vy = imax(p.vy - 260, -900);
      if (down) p.vy = imin(p.vy + 200, 900);
    } else if (p.onLadder) {
      p.vy = up ? -LADDER_SPEED : down ? LADDER_SPEED : 0;
      if (jump && !up) { p.vy = cls.jumpSpeed; p.onLadder = false; this.events.push({ kind: 'jump', x: p.x, y: p.y, player: p.id }); }
    } else {
      // 가변 점프: 짧게 누르면 낮게, 누르고 있으면 JUMP_HOLD_TICKS 동안 추가 상승 (KAG 식)
      if (wantJump && p.onGround) {
        p.vy = idiv(cls.jumpSpeed * 3, 4); p.onGround = false; p.jumpTicks = JUMP_HOLD_TICKS;
        this.events.push({ kind: 'jump', x: p.x, y: p.y, player: p.id });
      } else if (p.jumpTicks > 0) {
        if (wantJump && p.vy < 0) { p.vy += idiv(cls.jumpSpeed, 14); p.jumpTicks--; } else p.jumpTicks = 0;
      }
      p.vy = imin(p.vy + GRAVITY, MAX_FALL);
    }

    // 이동 + 충돌
    this.moveBody(p, w, h);

    // 가시 피해
    this.checkSpikes(p, w, h);

    // 액션
    this.updateActions(p, cls, inp, w, h);

    // 작업장: 서 있으면 서서히 회복, E 로 직업별 소모품 구매
    this.workshop(p, cls, inp, w, h);

    // 깃발 상호작용
    this.touchFlags(p, w, h);

    // 낙사/맵 밖
    if (p.y > (this.map.h << TILE_SHIFT)) this.kill(p, 0);
  }

  /**
   * [DEV] 치트 적용 (dev/cheats.ts 의 코드 표와 일치). 입력으로 전달되므로 모든 피어에서 같은 틱에 동일하게 실행된다.
   * 출시 전: CHEATS_ENABLED=false 로 전부 차단.
   */
  private applyCheat(p: Player, inp: Input): void {
    const cls = CLASSES[p.cls];
    const a0 = inp.a0 ?? 0, a1 = inp.a1 ?? 0;
    const fx = () => this.events.push({ kind: 'buy', x: p.x, y: p.y, player: p.id });
    const aimTile = (): [number, number] => [toTile(p.x + (px(cls.width) >> 1) + px(p.aimX)), toTile(p.y + (px(cls.height) >> 1) + px(p.aimY))];
    switch (inp.cheat) {
      case 1: p.wood = imin(p.wood + 1000, 9999); p.stone = imin(p.stone + 1000, 9999); p.gold = imin(p.gold + 1000, 9999); fx(); break;
      case 2: p.digCheat = p.digCheat ? 0 : 1; fx(); break;
      case 3: p.hp = cls.hp; fx(); break;
      case 4: p.god = p.god ? 0 : 1; fx(); break;
      case 5: { // tp x y (타일)
        const tx = clamp(a0, 1, this.map.w - 2), ty = clamp(a1, 1, this.map.h - 2);
        if (p.vehicle) dismount(this, p, 0, true);
        p.x = (tx << TILE_SHIFT) + ((TILE_FP - px(cls.width)) >> 1); p.y = (ty << TILE_SHIFT) - px(cls.height); p.vx = 0; p.vy = 0; fx(); break;
      }
      case 6: { // 직업 변경 (어디서나)
        if (a0 < 0 || a0 >= CLASSES.length) break;
        this.dropFlag(p); p.cls = a0; const n = CLASSES[a0]; p.hp = n.hp; p.bombs = n.bombs ?? 0; p.arrows = n.bow?.arrows ?? 0; p.slot = 0; p.charge = 0; p.animEvent++; fx(); break;
      }
      case 7: p.bombs = clamp(p.bombs + (a0 || 10), 0, 99); p.arrows = clamp(p.arrows + (a0 || 30), 0, 999); fx(); break; // ammo
      case 8: { // 탈것 생성 (플레이어 위치)
        const v = spawnVehicle(this, p.team, clamp(a0, 0, 0));
        v.x = p.x; v.y = p.y - px(8); fx(); break;
      }
      case 9: if (p.state === PlayerState.Alive) this.kill(p, 0); break; // 자살
      case 10: { // 적 깃발을 손에
        const f = this.flags[1 - p.team];
        if (p.state !== PlayerState.Alive || p.vehicle) break;
        if (f.carrier) { const c = this.getPlayer(f.carrier); if (c) c.carryingFlag = -1; }
        f.carrier = p.id; f.atHome = false; p.carryingFlag = f.team; fx(); break;
      }
      case 11: { // 물: 조준 칸 주변 (a0 반경, 기본 2) 을 물로 채움
        const [tx, ty] = aimTile(); const r = clamp(a0 || 2, 1, 8);
        for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) if (this.map.inBounds(x, y) && this.map.get(x, y) === T_AIR) this.map.water[y * this.map.w + x] = WATER_MAX;
        break;
      }
      case 12: { // 타일 설치: a0 = 타일 id, a1 = 1 이면 뒷벽
        const [tx, ty] = aimTile();
        if (a0 <= 0 || a0 >= TILE_TABLE.length || !TILE_TABLE[a0]) break;
        if (a1) this.map.setBack(tx, ty, a0); else this.map.set(tx, ty, a0, p.team);
        break;
      }
      case 13: { // 주변 비우기: a0 반경 (기본 4) — bedrock 제외, 앞 타일만
        const cx = toTile(p.x + (px(cls.width) >> 1)), cy = toTile(p.y + (px(cls.height) >> 1)); const r = clamp(a0 || 4, 1, 12);
        for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { const t = this.map.get(x, y); if (t !== T_AIR && TILE_TABLE[t].hp > 0) this.map.clearFront(x, y); }
        break;
      }
      case 14: // 라운드 종료: 내 팀 승리
        if (this.roundOverAt === 0) { this.score[p.team] = WIN_SCORE; this.roundOverAt = this.tick + ROUND_RESET_TICKS; }
        break;
      case 15: { // 더미 봇 생성 (조준 위치, a0 = 팀: 기본 적 팀, a1 = 직업)
        const [tx, ty] = aimTile();
        const team = a0 === 0 || a0 === 1 ? a0 : 1 - p.team;
        const d = this.addPlayer(this.nextDummyId++, 'dummy', team);
        d.cls = clamp(a1, 0, CLASSES.length - 1); d.state = PlayerState.Alive; d.hp = CLASSES[d.cls].hp;
        d.x = (tx << TILE_SHIFT) + ((TILE_FP - px(CLASSES[d.cls].width)) >> 1); d.y = (ty << TILE_SHIFT) - px(CLASSES[d.cls].height); d.vx = 0; d.vy = 0;
        break;
      }
      case 16: // 드롭 생성: a0 = 종류(0 나무 1 돌 2 금 3 폭탄 4 화살), a1 = 수량
        this.spawnDrop(clamp(a0, 0, 4), clamp(a1 || 10, 1, 9999), p.x + (px(cls.width) >> 1) + px(p.aimX), p.y, 0, -600); break;
      case 17: this.score[0] = clamp(a0, 0, 99); this.score[1] = clamp(a1, 0, 99); break; // 점수
      case 18: if (p.state === PlayerState.Dead) p.respawnAt = this.tick; break; // 즉시 부활
      case 19: { // 모든 더미 제거
        for (let i = this.players.length - 1; i >= 0; i--) if (this.players[i].id >= 900) this.removePlayer(this.players[i].id);
        break;
      }
      case 20: { // 시간 점프: a0 틱만큼 물/붕괴만 진행 (플레이어 없이) — 물 흐름 빨리 보기
        const n = clamp(a0 || 300, 1, 3000);
        for (let k = 0; k < n; k++) { if ((this.tick + k) % WATER_STEP_INTERVAL === 0) this.map.stepWater(this.tick + k); }
        break;
      }
      default: break;
    }
  }

  private onShop(p: Player, w: number, h: number): boolean {
    const x0 = toTile(p.x), x1 = toTile(p.x + w - 1);
    const y0 = toTile(p.y), y1 = toTile(p.y + h - 1);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) if (TILE_TABLE[this.map.get(tx, ty)].shop) return true;
    return false;
  }

  private workshop(p: Player, cls: ClassDef, inp: Input, w: number, h: number): void {
    if (!this.onShop(p, w, h)) return;
    // 회복: 30틱마다 1/4 하트
    if (p.hp < cls.hp && this.tick % 30 === 0) { p.hp++; }
    // 구매 (E 누른 순간)
    const use = (inp.buttons & BTN_USE) !== 0, usePrev = (p.lastInput.buttons & BTN_USE) !== 0;
    if (use && !usePrev && cls.shop) {
      const sh = cls.shop;
      const cur = sh.buy === 'bombs' ? p.bombs : p.arrows;
      if (cur < sh.max && this.canAfford(p, sh.cost)) {
        this.payCost(p, sh.cost);
        if (sh.buy === 'bombs') p.bombs = imin(sh.max, p.bombs + sh.amount);
        else p.arrows = imin(sh.max, p.arrows + sh.amount);
        this.events.push({ kind: 'buy', x: p.x, y: p.y, player: p.id });
      }
    }
  }

  /** 기지 영역: 팀 스폰 지점 기준 가로 ±10 타일, 세로 ±8 타일 */
  inBase(p: Player): boolean {
    const f = this.flags[p.team];
    const cx = toTile(p.x + px(CLASSES[p.cls].width) / 2);
    return iabs(cx - this.spawnX[p.team]) <= 10 && iabs(toTile(p.y) - f.homeY) <= 8;
  }

  /** AABB 를 vx,vy 만큼 타일 충돌을 고려해 이동. 서브스텝으로 터널링 방지. */
  private moveBody(p: Player, w: number, h: number): void {
    let remX = p.vx, remY = p.vy;
    p.onGround = false;
    while (remX !== 0 || remY !== 0) {
      const sx = clamp(remX, -MAX_STEP, MAX_STEP);
      const sy = clamp(remY, -MAX_STEP, MAX_STEP);
      remX -= sx; remY -= sy;
      // X
      if (sx !== 0) {
        const nx = p.x + sx;
        if (this.collides(nx, p.y, w, h, p.team)) {
          // 타일 경계로 스냅
          if (sx > 0) p.x = ((toTile(nx + w - 1)) << TILE_SHIFT) - w;
          else p.x = (toTile(nx) + 1) << TILE_SHIFT;
          p.vx = 0; remX = 0;
        } else p.x = nx;
      }
      // Y
      if (sy !== 0) {
        const ny = p.y + sy;
        if (this.collides(p.x, ny, w, h, p.team)) {
          if (sy > 0) { p.y = (toTile(ny + h - 1) << TILE_SHIFT) - h; p.onGround = true; }
          else p.y = (toTile(ny) + 1) << TILE_SHIFT;
          p.vy = 0; remY = 0;
        } else p.y = ny;
      }
    }
    // 정지 상태 접지 검사
    if (!p.onGround && p.vy >= 0 && this.collides(p.x, p.y + 1, w, h, p.team)) p.onGround = true;
  }

  /** 탈것 등 외부 모듈용 공개 충돌 검사 */
  collidesAt(x: number, y: number, w: number, h: number, team: number): boolean { return this.collides(x, y, w, h, team); }
  /** 근처에 탈 수 있는 탈것이 있는가 (HUD 힌트) */
  canMount(p: Player): boolean { return p.state === PlayerState.Alive && !p.vehicle && nearestMountable(this, p) !== undefined; }

  private collides(x: number, y: number, w: number, h: number, team: number): boolean {
    const x0 = toTile(x), x1 = toTile(x + w - 1);
    const y0 = toTile(y), y1 = toTile(y + h - 1);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (this.map.solidFor(tx, ty, team)) return true;
    return false;
  }

  private anyPlayerOverlapsTile(tx: number, ty: number): boolean {
    const bx = tx << TILE_SHIFT, by = ty << TILE_SHIFT;
    for (const q of this.players) {
      if (q.state !== PlayerState.Alive) continue;
      const c = CLASSES[q.cls];
      if (aabbOverlap(q.x, q.y, px(c.width), px(c.height), bx, by, TILE_FP, TILE_FP)) return true;
    }
    return false;
  }

  private checkSpikes(p: Player, w: number, h: number): void {
    const x0 = toTile(p.x), x1 = toTile(p.x + w - 1);
    const y0 = toTile(p.y), y1 = toTile(p.y + h - 1);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const d = TILE_TABLE[this.map.get(tx, ty)];
        if (d.damage && p.hurtTimer === 0 && (p.vy > 300 || iabs(p.vx) > 300)) {
          this.hurt(p, d.damage, 0, -isign(p.vx) * 600, -900);
          p.hurtTimer = 20;
          return;
        }
      }
  }

  // ---------- 액션 ----------
  private updateActions(p: Player, cls: ClassDef, inp: Input, w: number, h: number): void {
    const item = hotbarItem(cls, p.slot);
    if (!item) return;
    const a1 = (inp.buttons & BTN_ACTION1) !== 0;
    const a1Prev = (p.lastInput.buttons & BTN_ACTION1) !== 0;
    const cx = p.x + (w >> 1), cy = p.y + (h >> 1);

    // 진행 중인 검 휘두르기
    if (p.attackWindup > 0) {
      p.attackWindup--;
      if (p.attackWindup === 0 && cls.attack) this.doSlash(p, cls, cx, cy);
    }

    switch (item.id) {
      case 'sword': {
        if (a1 && !p.shield && p.attackTimer === 0 && cls.attack) {
          p.attackTimer = cls.attack.cooldown;
          p.attackWindup = cls.attack.windup;
          p.animEvent++;
          this.events.push({ kind: 'slash', x: cx, y: cy, player: p.id });
        }
        break;
      }
      case 'bomb': {
        // 투척: 좌클릭을 누르고 있는 시간(게이지)에 따라 던지는 속도 = 거리. 놓으면 발사.
        if (a1 && p.bombs > 0 && p.attackTimer === 0) {
          p.charge = imin(p.charge + 1, THROW_CHARGE_TICKS);
        } else if (!a1 && p.charge > 0) {
          const c = p.charge;
          p.charge = 0;
          if (p.bombs > 0) {
            p.bombs--;
            p.attackTimer = 15;
            const speed = THROW_MIN_SPEED + idiv((THROW_MAX_SPEED - THROW_MIN_SPEED) * c, THROW_CHARGE_TICKS);
            const [vx, vy] = vnorm(inp.cx || p.facing, inp.cy, speed);
            this.projectiles.push({
              id: this.nextProjId++, kind: ProjKind.Bomb, owner: p.id, team: p.team,
              x: cx, y: cy, vx: vx + idiv(p.vx, 2), vy: vy - 200, timer: cls.bombFuse ?? 90,
              damage: cls.bombDamage ?? 10, stuck: false,
            });
            p.animEvent++;
          }
        }
        break;
      }
      case 'bow': {
        const bow = cls.bow!;
        if (a1 && p.arrows > 0) {
          p.charge = imin(p.charge + 1, bow.chargeTicks);
        } else if (!a1 && p.charge > 0) {
          const c = p.charge;
          p.charge = 0;
          if (c >= 4 && p.arrows > 0) {
            p.arrows--;
            const speed = bow.minSpeed + idiv((bow.maxSpeed - bow.minSpeed) * c, bow.chargeTicks);
            const dmg = bow.damageMin + idiv((bow.damageMax - bow.damageMin) * c, bow.chargeTicks);
            // FPS 의 "총구 vs 조준점" 처리와 같은 방식: 화살은 활을 든 손 위치에서 나가되,
            // 방향은 손 → 커서(조준점) 으로 다시 계산해 커서에 수렴한다. 손 위치가 벽 속이면 몸 중앙에서 발사.
            const [ax, ay] = this.bowHand(p, bow, cx, cy);
            let dx = cx + px(inp.cx) - ax, dy = cy + px(inp.cy) - ay;
            if (iabs(dx) + iabs(dy) < px(2)) { dx = inp.cx; dy = inp.cy; }
            const [vx, vy] = vnorm(dx, dy, speed);
            this.projectiles.push({
              id: this.nextProjId++, kind: ProjKind.Arrow, owner: p.id, team: p.team,
              x: ax, y: ay, vx, vy, timer: ARROW_LIFE, damage: dmg, stuck: false,
            });
            p.animEvent++;
            this.events.push({ kind: 'shoot', x: ax, y: ay, player: p.id });
          }
        }
        break;
      }
      case 'pickaxe': {
        const dig = cls.dig!;
        if (!a1) p.digMode = 0;
        if (a1 && p.attackTimer === 0) {
          p.attackTimer = dig.cooldown;
          p.animEvent++;
          const [tx, ty] = this.rayTile(p.team, cx, cy, inp.cx, inp.cy, dig.reach);
          const t = this.map.get(tx, ty);
          const bt = this.map.getBack(tx, ty);
          // 누른 순간의 대상으로 모드 결정: 앞 타일을 파기 시작했으면 홀드 중 뒷벽은 파지 않음
          if (!a1Prev || p.digMode === 0) p.digMode = t !== T_AIR ? 1 : 2;
          if (t !== T_AIR && TILE_TABLE[t].hp > 0) {
            const def = TILE_TABLE[t];
            const destroyed = this.map.damage(tx, ty, p.digCheat ? 99 : dig.damage);
            this.events.push({ kind: 'dig', x: (tx << TILE_SHIFT) + TILE_FP / 2, y: (ty << TILE_SHIFT) + TILE_FP / 2, tile: t });
            if (destroyed) this.yieldTile(p, def, tx, ty);
          } else if (t === T_AIR && bt !== T_AIR && TILE_TABLE[bt].hp > 0 && p.digMode === 2) {
            // 앞이 비어 있는 곳을 새로 클릭했을 때만 뒷벽을 판다
            const def = TILE_TABLE[bt];
            const destroyed = this.map.damageBack(tx, ty, p.digCheat ? 99 : dig.damage);
            this.events.push({ kind: 'dig', x: (tx << TILE_SHIFT) + TILE_FP / 2, y: (ty << TILE_SHIFT) + TILE_FP / 2, tile: bt });
            if (destroyed) this.yieldTile(p, def, tx, ty);
          } else {
            // 적 플레이어 타격 (약한 근접)
            this.meleeHit(p, cx, cy, px(dig.reach), 1, 300);
          }
        }
        break;
      }
      default: {
        // 블록 설치
        if (item.kind === 'block' && item.tile && a1 && p.attackTimer === 0 && cls.build) {
          const [tx, ty] = this.targetTile(cx, cy, inp.cx, inp.cy, cls.build.reach);
          const tid = tileId(item.tile);
          const def = TILE_TABLE[tid];
          if (this.canBuildAt(p, tid, tx, ty, cx, cy)) {
            this.payCost(p, item.cost);
            if (def.layer === 'back') this.map.setBack(tx, ty, tid);
            else this.map.set(tx, ty, tid, def.door ? p.team : NO_TEAM);
            p.attackTimer = cls.build.cooldown;
            p.animEvent++;
            this.events.push({ kind: 'build', x: (tx << TILE_SHIFT) + TILE_FP / 2, y: (ty << TILE_SHIFT) + TILE_FP / 2, tile: tid });
          }
        }
      }
    }
  }

  /** 커서 방향으로 reach(px) 이내의 타일 좌표 */
  private targetTile(cx: number, cy: number, ax: number, ay: number, reachPx: number): [number, number] {
    const reach = px(reachPx);
    let ox = px(ax), oy = px(ay);
    const l = vlen(ox, oy);
    if (l > reach) { [ox, oy] = vnorm(ox, oy, reach); }
    return [toTile(cx + ox), toTile(cy + oy)];
  }

  /**
   * 시선 광선: (x0,y0)→(x1,y1) 을 반 타일 간격으로 샘플링해 처음 만나는 고체 타일을 돌려준다.
   * 고체가 없으면 끝점 타일. 결정론적 정수 연산.
   */
  private castRay(team: number, x0: number, y0: number, x1: number, y1: number): { tx: number; ty: number; blocked: boolean } {
    const dx = x1 - x0, dy = y1 - y0;
    const len = vlen(dx, dy);
    const n = imax(1, idiv(len + (TILE_FP >> 2) - 1, TILE_FP >> 2));
    let prevTx = toTile(x0), prevTy = toTile(y0);
    for (let i = 1; i <= n; i++) {
      const x = x0 + idiv(dx * i, n), y = y0 + idiv(dy * i, n);
      const tx = toTile(x), ty = toTile(y);
      if (tx === prevTx && ty === prevTy) continue;
      // 대각선으로 모서리를 통과하지 못하도록 인접 두 칸 중 하나라도 뚫려 있어야 함
      if (tx !== prevTx && ty !== prevTy && this.map.solidFor(tx, prevTy, team) && this.map.solidFor(prevTx, ty, team))
        return { tx: tx, ty: prevTy, blocked: true };
      if (this.map.solidFor(tx, ty, team)) return { tx, ty, blocked: true };
      prevTx = tx; prevTy = ty;
    }
    return { tx: toTile(x1), ty: toTile(y1), blocked: false };
  }

  /** 두 점 사이에 고체 타일이 없는가 (끝점 타일 자체는 제외) */
  private lineClear(team: number, x0: number, y0: number, x1: number, y1: number): boolean {
    const r = this.castRay(team, x0, y0, x1, y1);
    return !r.blocked || (r.tx === toTile(x1) && r.ty === toTile(y1));
  }

  /** 커서 방향 reach 이내에서 처음 만나는 고체 타일(없으면 끝점 타일) */
  private rayTile(team: number, cx: number, cy: number, ax: number, ay: number, reachPx: number): [number, number] {
    const reach = px(reachPx);
    let ox = px(ax), oy = px(ay);
    const l = vlen(ox, oy);
    if (l > reach) { [ox, oy] = vnorm(ox, oy, reach); }
    const r = this.castRay(team, cx, cy, cx + ox, cy + oy);
    return [r.tx, r.ty];
  }

  /** 렌더러용: 현재 조준으로 영향을 줄 타일과 가능 여부 (시뮬과 같은 규칙) */
  previewTarget(p: Player): { tx: number; ty: number; ok: boolean } | null {
    const cls = CLASSES[p.cls];
    const item = hotbarItem(cls, p.slot);
    if (!item || p.state !== PlayerState.Alive) return null;
    const cx = p.x + (px(cls.width) >> 1), cy = p.y + (px(cls.height) >> 1);
    if (item.id === 'pickaxe' && cls.dig) {
      const [tx, ty] = this.rayTile(p.team, cx, cy, p.aimX, p.aimY, cls.dig.reach);
      const t = this.map.get(tx, ty), bt = this.map.getBack(tx, ty);
      return { tx, ty, ok: (t !== T_AIR && TILE_TABLE[t].hp > 0) || (t === T_AIR && bt !== T_AIR && TILE_TABLE[bt].hp > 0) };
    }
    if (item.kind === 'block' && item.tile && cls.build) {
      const [tx, ty] = this.targetTile(cx, cy, p.aimX, p.aimY, cls.build.reach);
      return { tx, ty, ok: this.canBuildAt(p, tileId(item.tile), tx, ty, cx, cy) };
    }
    return null;
  }

  /** 건설 규칙: 자원, 시선, 지지대, (고체면) 엔티티 겹침 */
  private canBuildAt(p: Player, tid: number, tx: number, ty: number, cx: number, cy: number): boolean {
    const def = TILE_TABLE[tid];
    const item = hotbarItem(CLASSES[p.cls], p.slot);
    if (!this.canAfford(p, item?.cost)) return false;
    if (!this.lineClear(p.team, cx, cy, (tx << TILE_SHIFT) + TILE_FP / 2, (ty << TILE_SHIFT) + TILE_FP / 2)) return false;
    if (def.layer === 'back') return this.map.canPlaceBack(tx, ty);
    if (!this.map.canPlace(tx, ty)) return false;
    if (def.solid && this.anyPlayerOverlapsTile(tx, ty)) return false;
    return true;
  }

  /** 활을 든 손의 위치(FP). 몸 중앙(cx,cy) 기준 위로 handY, 조준 방향으로 handReach. 시선이 막히면 몸 중앙 */
  bowHand(p: Player, bow: NonNullable<ClassDef['bow']>, cx: number, cy: number): [number, number] {
    const reach = px(bow.handReach ?? 0);
    const [ox, oy] = reach > 0 ? vnorm(p.aimX || p.facing, p.aimY, reach) : [0, 0];
    const hx = cx + ox, hy = cy + px(bow.handY ?? 0) + oy;
    if (this.map.isSolid(toTile(hx), toTile(hy)) || !this.lineClear(p.team, cx, cy, hx, hy)) return [cx, cy];
    return [hx, hy];
  }

  private doSlash(p: Player, cls: ClassDef, cx: number, cy: number): void {
    const atk = cls.attack!;
    const range = px(atk.range);
    this.meleeHit(p, cx, cy, range, atk.damage, atk.knockback);
    // 검으로 타일 약간 파괴 (나무/사다리 등 약한 것)
    const [tx, ty] = this.rayTile(p.team, cx, cy, p.aimX || p.facing * 8, p.aimY, atk.range);
    const t = this.map.get(tx, ty);
    const d = TILE_TABLE[t];
    if (t !== T_AIR && d.hp > 0 && (d.hp <= 6 || d.buildable)) {
      const destroyed = this.map.damage(tx, ty, 1);
      this.events.push({ kind: 'dig', x: (tx << TILE_SHIFT) + TILE_FP / 2, y: (ty << TILE_SHIFT) + TILE_FP / 2, tile: t });
      if (destroyed) this.yieldTile(p, d, tx, ty);
    }
  }

  /** 타일 파괴 보상: drop 타일(나무)은 바닥에 아이템으로, 나머지는 즉시 지급 */
  private yieldTile(p: Player | null, def: TileDef, tx: number, ty: number): void {
    if (!def.yields) return;
    if (def.drop) {
      const cx = (tx << TILE_SHIFT) + TILE_FP / 2, cy = (ty << TILE_SHIFT) + TILE_FP / 2;
      for (let k = 0; k < RESOURCE_KINDS.length; k++) {
        const amt = def.yields[RESOURCE_KINDS[k]];
        if (amt) this.spawnDrop(k, amt, cx, cy, this.rng.range(-300, 300), -this.rng.range(200, 600));
      }
    } else if (p) this.giveResources(p, def.yields);
  }

  spawnDrop(kind: number, amount: number, x: number, y: number, vx: number, vy: number): void {
    if (this.drops.length >= MAX_DROPS) this.drops.shift();
    this.drops.push({ id: this.nextDropId++, kind, amount, x, y, vx, vy, life: DROP_LIFE });
  }

  private meleeHit(p: Player, cx: number, cy: number, range: number, damage: number, knockback: number): void {
    // 히트박스: 조준 방향으로 range 만큼 뻗은 사각형
    const [dx, dy] = vnorm(p.aimX || p.facing, p.aimY, range);
    const hx = cx + idiv(dx, 2) - idiv(range, 2), hy = cy + idiv(dy, 2) - idiv(range, 2);
    for (const q of this.players) {
      if (q === p || q.state !== PlayerState.Alive || q.team === p.team) continue;
      const c = CLASSES[q.cls];
      if (aabbOverlap(hx, hy, range, range, q.x, q.y, px(c.width), px(c.height))) {
        // 벽 너머로는 타격 불가
        if (!this.lineClear(p.team, cx, cy, q.x + px(c.width) / 2, q.y + px(c.height) / 2)) continue;
        // 방패: 공격자가 방패 전면에 있으면 막힘
        if (q.shield && isign(cx - (q.x + px(c.width) / 2)) === q.facing) {
          this.events.push({ kind: 'hit', x: q.x, y: q.y, player: q.id, team: -1 });
          continue;
        }
        this.hurt(q, damage, p.id, isign(dx) * knockback, -idiv(knockback, 2));
      }
    }
  }

  hurt(q: Player, damage: number, byPid: number, kx: number, ky: number): void {
    if (CHEATS_ENABLED && q.god) return;
    if (q.state !== PlayerState.Alive) return;
    q.hp -= damage;
    q.vx += kx; q.vy += ky;
    q.hurtTimer = HURT_TICKS;
    this.events.push({ kind: 'hit', x: q.x, y: q.y, player: q.id, tile: damage });
    if (q.hp <= 0) this.kill(q, byPid);
  }

  private kill(q: Player, byPid: number): void {
    if (q.state !== PlayerState.Alive) return;
    q.state = PlayerState.Dead;
    q.respawnAt = this.tick + RESPAWN_TICKS;
    q.deaths++;
    q.hp = 0;
    const killer = byPid ? this.getPlayer(byPid) : undefined;
    if (killer && killer !== q) killer.kills++;
    if (q.vehicle) dismount(this, q, 0, true);
    this.dropFlag(q);
    this.dropResources(q);
    this.events.push({ kind: 'die', x: q.x, y: q.y, player: q.id, team: q.team, by: byPid });
  }

  /** 사망 시 들고 있던 자원을 바닥에 흩뿌린다 */
  private dropResources(q: Player): void {
    const c = CLASSES[q.cls];
    const cx = q.x + (px(c.width) >> 1), cy = q.y + (px(c.height) >> 1);
    const kinds: [number, number][] = [[DropKind.Wood, q.wood], [DropKind.Stone, q.stone], [DropKind.Gold, q.gold], [DropKind.Bombs, q.bombs], [DropKind.Arrows, q.arrows]];
    for (const [kind, amount] of kinds) {
      if (amount <= 0) continue;
      this.spawnDrop(kind, amount, cx, cy, this.rng.range(-700, 700), -this.rng.range(600, 1400));
    }
    q.wood = 0; q.stone = 0; q.gold = 0; q.bombs = 0; q.arrows = 0;
  }

  private updateDrops(): void {
    const arr = this.drops;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i];
      d.life--;
      if (d.life <= 0 || d.y > (this.map.h << TILE_SHIFT)) { arr.splice(i, 1); i--; continue; }
      // 물리: 중력 + 타일 충돌(멈춤), 지면 마찰
      d.vy = imin(d.vy + GRAVITY, MAX_FALL);
      const nx = d.x + d.vx;
      if (this.map.isSolid(toTile(nx), toTile(d.y))) d.vx = -idiv(d.vx, 2); else d.x = nx;
      const ny = d.y + d.vy;
      if (this.map.isSolid(toTile(d.x), toTile(ny))) { d.vy = 0; d.vx = idiv(d.vx * 3, 4); } else d.y = ny;
      // 바닥에 멈춘 같은 종류 드롭이 가까이 있으면 합친다 (id 작은 쪽으로)
      if (d.vy === 0) {
        let merged = false;
        for (let j = 0; j < i; j++) {
          const o = arr[j];
          if (o.kind !== d.kind || o.vy !== 0 || iabs(o.x - d.x) > 1024 || iabs(o.y - d.y) > 1024) continue;
          o.amount = imin(o.amount + d.amount, 9999); o.life = imax(o.life, d.life);
          arr.splice(i, 1); i--; merged = true; break;
        }
        if (merged) continue;
      }
      // 줍기
      if (DROP_LIFE - d.life < DROP_PICKUP_DELAY) continue;
      for (const p of this.players) {
        if (p.state !== PlayerState.Alive) continue;
        const c = CLASSES[p.cls];
        if (!aabbOverlap(d.x - 512, d.y - 512, 1024, 1024, p.x, p.y, px(c.width), px(c.height))) continue;
        const took = this.pickup(p, c, d);
        if (took <= 0) continue;
        this.events.push({ kind: 'loot', x: d.x, y: d.y, player: p.id, tile: d.kind, by: took });
        d.amount -= took;
        if (d.amount <= 0) { arr.splice(i, 1); i--; }
        break;
      }
    }
  }

  /** 드롭을 플레이어에게 넣고 실제로 가져간 양을 돌려준다. 폭탄/화살은 그 직업만, 최대치까지 */
  private pickup(p: Player, c: ClassDef, d: Drop): number {
    switch (d.kind) {
      case DropKind.Wood: { const n = imin(d.amount, 9999 - p.wood); p.wood += n; return n; }
      case DropKind.Stone: { const n = imin(d.amount, 9999 - p.stone); p.stone += n; return n; }
      case DropKind.Gold: { const n = imin(d.amount, 9999 - p.gold); p.gold += n; return n; }
      case DropKind.Bombs: { if (!c.bombs) return 0; const n = imin(d.amount, c.bombs - p.bombs); p.bombs += n; return n; }
      case DropKind.Arrows: { if (!c.bow) return 0; const n = imin(d.amount, c.bow.arrows - p.arrows); p.arrows += n; return n; }
    }
    return 0;
  }

  private giveResources(p: Player, y: Partial<Record<ResourceKind, number>>): void {
    for (const k of RESOURCE_KINDS) if (y[k]) p[k] = imin(p[k] + y[k]!, 9999);
  }
  private canAfford(p: Player, cost?: Partial<Record<ResourceKind, number>>): boolean {
    if (!cost) return true;
    for (const k of RESOURCE_KINDS) if (cost[k] && p[k] < cost[k]!) return false;
    return true;
  }
  private payCost(p: Player, cost?: Partial<Record<ResourceKind, number>>): void {
    if (!cost) return;
    for (const k of RESOURCE_KINDS) if (cost[k]) p[k] -= cost[k]!;
  }

  // ---------- 투사체 ----------
  private updateProjectiles(): void {
    const arr = this.projectiles;
    for (let i = 0; i < arr.length; i++) {
      const pr = arr[i];
      pr.timer--;
      if (pr.timer <= 0) {
        if (pr.kind === ProjKind.Bomb) this.explode(pr);
        arr.splice(i, 1); i--;
        continue;
      }
      if (pr.stuck) continue;
      if (pr.kind === ProjKind.Arrow) {
        pr.vy = imin(pr.vy + (CLASSES[1].bow?.arrowGravity ?? 40), MAX_FALL);
        // 서브스텝 이동, 타일 충돌 시 박힘 / 각 서브스텝마다 플레이어 명중 검사 (터널링 방지)
        const res = this.moveProjectile(pr, false, (x, y) => this.arrowHitPlayer(pr, x, y));
        if (res === 'hitPlayer') { arr.splice(i, 1); i--; continue; }
        if (res === 'tile') { pr.stuck = true; pr.timer = STUCK_ARROW_LIFE; continue; }
      } else {
        pr.vy = imin(pr.vy + GRAVITY, MAX_FALL);
        this.moveProjectile(pr, true);
      }
    }
  }

  /** 화살이 (x,y) 에서 적 플레이어와 겹치면 피해를 주고 true. 방패에 막히면 튕기고 false. */
  private arrowHitPlayer(pr: Projectile, x: number, y: number): boolean {
    for (const q of this.players) {
      if (q.state !== PlayerState.Alive || q.team === pr.team) continue;
      const c = CLASSES[q.cls];
      if (!aabbOverlap(x - 128, y - 128, 256, 256, q.x, q.y, px(c.width), px(c.height))) continue;
      if (q.shield && isign(pr.vx) === -q.facing) {
        pr.vx = -idiv(pr.vx, 3); pr.vy = -600; pr.timer = 20; // 튕김
        this.events.push({ kind: 'hit', x: q.x, y: q.y, player: q.id, team: -1 });
        return false;
      }
      this.hurt(q, pr.damage, pr.owner, isign(pr.vx) * 300, -200);
      return true;
    }
    for (const v of this.vehicles) {
      if (v.team === pr.team) continue;
      const d = vehicleDef(v);
      if (!aabbOverlap(x - 128, y - 128, 256, 256, v.x, v.y, px(d.width), px(d.height))) continue;
      damageVehicle(this, v, pr.damage, pr.owner);
      return true;
    }
    return false;
  }

  /** 투사체 이동. 'tile' = 타일 충돌(정지/반사), 'hitPlayer' = onStep 이 true 반환, 'none' = 없음. */
  private moveProjectile(pr: Projectile, bounce: boolean, onStep?: (x: number, y: number) => boolean): 'none' | 'tile' | 'hitPlayer' {
    let remX = pr.vx, remY = pr.vy;
    let hit = false;
    while (remX !== 0 || remY !== 0) {
      const sx = clamp(remX, -MAX_STEP, MAX_STEP), sy = clamp(remY, -MAX_STEP, MAX_STEP);
      remX -= sx; remY -= sy;
      const nx = pr.x + sx;
      if (this.map.solidFor(toTile(nx), toTile(pr.y), pr.team)) {
        hit = true;
        if (bounce) { pr.vx = -idiv(pr.vx, 2); remX = 0; }
        else { pr.vx = 0; pr.vy = 0; return 'tile'; }
      } else pr.x = nx;
      const ny = pr.y + sy;
      if (this.map.solidFor(toTile(pr.x), toTile(ny), pr.team)) {
        hit = true;
        if (bounce) {
          pr.vy = -idiv(pr.vy, 2); remY = 0;
          pr.vx = idiv(pr.vx * 3, 4); // 마찰
        } else { pr.vx = 0; pr.vy = 0; return 'tile'; }
      } else pr.y = ny;
      if (onStep && onStep(pr.x, pr.y)) return 'hitPlayer';
    }
    if (pr.x < 0 || pr.x >= (this.map.w << TILE_SHIFT) || pr.y < -TILE_FP * 8) { pr.timer = 1; }
    return hit ? 'tile' : 'none';
  }

  private explode(pr: Projectile): void {
    const cls = CLASSES[0];
    const radius = px(cls.bombRadius ?? 28);
    const tileDmg = cls.bombTileDamage ?? 6;
    this.events.push({ kind: 'explode', x: pr.x, y: pr.y });
    // 플레이어 피해 (거리 비례)
    for (const q of this.players) {
      if (q.state !== PlayerState.Alive) continue;
      const c = CLASSES[q.cls];
      const qx = q.x + px(c.width) / 2, qy = q.y + px(c.height) / 2;
      const d = vlen(qx - pr.x, qy - pr.y);
      if (d < radius && this.lineClear(NO_TEAM, pr.x, pr.y, qx, qy)) {
        const dmg = imax(1, pr.damage - idiv(pr.damage * d, radius));
        const [kx, ky] = vnorm(qx - pr.x, qy - pr.y, 1400);
        this.hurt(q, dmg, pr.owner, kx, ky - 400);
      }
    }
    for (const v of this.vehicles) {
      const d = vehicleDef(v);
      const vx = v.x + (px(d.width) >> 1), vy = v.y + (px(d.height) >> 1);
      const dist = vlen(vx - pr.x, vy - pr.y);
      if (dist < radius && this.lineClear(NO_TEAM, pr.x, pr.y, vx, vy)) damageVehicle(this, v, imax(1, (pr.damage * 3 - idiv(pr.damage * 3 * dist, radius))), pr.owner);
    }
    // 타일 파괴 (원형)
    const tr = (radius >> TILE_SHIFT) + 1;
    const cx = toTile(pr.x), cy = toTile(pr.y);
    for (let ty = cy - tr; ty <= cy + tr; ty++)
      for (let tx = cx - tr; tx <= cx + tr; tx++) {
        const dx = (tx << TILE_SHIFT) + TILE_FP / 2 - pr.x;
        const dy = (ty << TILE_SHIFT) + TILE_FP / 2 - pr.y;
        const d = vlen(dx, dy);
        if (d <= radius) {
          const dmg = imax(1, tileDmg - idiv(tileDmg * d, radius * 2));
          if (this.map.get(tx, ty) !== T_AIR) this.map.damage(tx, ty, dmg);
          else if (d <= radius >> 1) this.map.damageBack(tx, ty, idiv(dmg, 2));
        }
      }
  }

  // ---------- 깃발 (CTF) ----------
  private touchFlags(p: Player, w: number, h: number): void {
    for (const f of this.flags) {
      if (f.carrier !== 0) continue;
      if (!aabbOverlap(p.x, p.y, w, h, f.x - TILE_FP / 2, f.y - TILE_FP, TILE_FP, TILE_FP * 2)) continue;
      if (f.team !== p.team) {
        // 적 깃발 획득
        if (p.carryingFlag < 0) {
          f.carrier = p.id; f.atHome = false; p.carryingFlag = f.team;
          this.events.push({ kind: 'pickup', x: p.x, y: p.y, player: p.id, team: f.team });
        }
      } else if (!f.atHome) {
        this.returnFlag(f);
      } else if (p.carryingFlag >= 0) {
        // 자기 깃발이 집에 있고, 적 깃발을 들고 도착 → 득점
        const ef = this.flags[p.carryingFlag];
        ef.carrier = 0; p.carryingFlag = -1;
        this.returnFlag(ef);
        this.score[p.team]++;
        this.events.push({ kind: 'capture', x: p.x, y: p.y, player: p.id, team: p.team });
        if (this.score[p.team] >= WIN_SCORE && this.roundOverAt === 0) this.roundOverAt = this.tick + ROUND_RESET_TICKS;
      }
    }
  }

  dropFlag(p: Player): void {
    if (p.carryingFlag < 0) return;
    const f = this.flags[p.carryingFlag];
    f.carrier = 0;
    f.x = p.x + px(CLASSES[p.cls].width) / 2;
    f.y = p.y + px(CLASSES[p.cls].height) / 2;
    f.returnTimer = FLAG_RETURN_TICKS;
    p.carryingFlag = -1;
  }

  private returnFlag(f: Flag): void {
    f.atHome = true; f.carrier = 0; f.returnTimer = 0;
    f.x = (f.homeX << TILE_SHIFT) + TILE_FP / 2;
    f.y = (f.homeY << TILE_SHIFT) + TILE_FP / 2;
  }

  private updateFlags(): void {
    for (const f of this.flags) {
      if (f.carrier !== 0) {
        const c = this.getPlayer(f.carrier);
        if (!c || c.state !== PlayerState.Alive) { f.carrier = 0; f.returnTimer = FLAG_RETURN_TICKS; continue; }
        f.x = c.x + px(CLASSES[c.cls].width) / 2;
        f.y = c.y;
      } else if (!f.atHome) {
        // 떨어진 깃발: 중력
        if (!this.map.isSolid(toTile(f.x), toTile(f.y + TILE_FP / 2))) f.y += 400;
        if (--f.returnTimer <= 0) this.returnFlag(f);
      }
    }
  }
}
