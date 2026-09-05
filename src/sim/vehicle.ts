/**
 * 탈것 물리 (정수 결정론). World 에서 호출한다.
 * - 차체는 AABB 로 타일과 충돌하고 접지 상태에서 1칸(8px) 계단을 자동으로 오른다.
 * - 기울기는 앞/뒤 바퀴 아래 지면 높이 차로 구한다 (BAM). 포탑/좌석 위치 계산에도 쓰이므로 시뮬 상태의 일부.
 * - 운전자는 좌석에 고정되고, 운전자의 좌/우 입력이 가속이 된다. E 로 타고 내린다.
 * - 빠르게 달리며 적 플레이어와 겹치면 들이받기 피해.
 */
import { TILE_FP, TILE_SHIFT, px, toTile, clamp, iabs, isign, imin, imax, idiv, batan2, aabbOverlap } from './fixed';
import { CLASSES, VEHICLES, type VehicleDef } from '../data/defs';
import { BTN_LEFT, BTN_RIGHT, BTN_USE, type Input } from './input';
import { PlayerState, type Player, type Vehicle } from './types';
import { WATER_MAX } from './tilemap';
import type { World } from './world';

const GRAVITY = 110;
const MAX_FALL = 2400;
const MAX_STEP = 900;
const MOUNT_RANGE = px(14);
const BREATH_TICKS = 300;

export function vehicleDef(v: Vehicle): VehicleDef { return VEHICLES[v.kind]; }

/** 기지 옆 지면 위에 팀 탈것을 생성한다 */
export function spawnVehicle(world: World, team: number, kind = 0): Vehicle {
  const def = VEHICLES[kind];
  const tx = world.spawnX[team] + (team === 0 ? def.spawnOffset : -def.spawnOffset);
  let ty = 0;
  while (ty < world.map.h - 1 && !world.map.isSolid(tx, ty)) ty++;
  const w = px(def.width), h = px(def.height);
  const v: Vehicle = {
    id: world.nextVehicleId++, kind, team,
    x: (tx << TILE_SHIFT) + TILE_FP / 2 - (w >> 1), y: (ty << TILE_SHIFT) - h - TILE_FP,
    vx: 0, vy: 0, onGround: false, angle: 0, hp: def.hp, driver: 0, facing: team === 0 ? 1 : -1, ramTimer: 0, odo: 0,
  };
  world.vehicles.push(v);
  return v;
}

export function findVehicle(world: World, id: number): Vehicle | undefined {
  for (const v of world.vehicles) if (v.id === id) return v;
  return undefined;
}

/** 플레이어가 탈 수 있는 가까운 빈 탈것 (같은 팀) */
export function nearestMountable(world: World, p: Player): Vehicle | undefined {
  const c = CLASSES[p.cls];
  const cx = p.x + (px(c.width) >> 1), cy = p.y + (px(c.height) >> 1);
  let best: Vehicle | undefined, bestD = 0;
  for (const v of world.vehicles) {
    if (v.driver !== 0 || v.team !== p.team) continue;
    const def = vehicleDef(v);
    const vx = v.x + (px(def.width) >> 1), vy = v.y + (px(def.height) >> 1);
    const d = iabs(vx - cx) + iabs(vy - cy);
    if (d <= MOUNT_RANGE * 2 && (!best || d < bestD)) { best = v; bestD = d; }
  }
  return best;
}

/** 좌석 위치(플레이어 AABB 좌상단) */
export function seatPos(v: Vehicle, p: Player): [number, number] {
  const def = vehicleDef(v), c = CLASSES[p.cls];
  const cx = v.x + (px(def.width) >> 1) + px(def.seatX) * v.facing;
  const cy = v.y + (px(def.height) >> 1) + px(def.seatY);
  return [cx - (px(c.width) >> 1), cy - (px(c.height) >> 1)];
}

/** E 입력 처리: 타기/내리기. 처리했으면 true */
export function handleMount(world: World, p: Player, inp: Input): boolean {
  const use = (inp.buttons & BTN_USE) !== 0, usePrev = (p.lastInput.buttons & BTN_USE) !== 0;
  if (!use || usePrev) return false;
  if (p.vehicle) { dismount(world, p, 0); return true; } // 자리가 없으면 그대로 탄 채
  const v = nearestMountable(world, p);
  if (!v) return false;
  // 좌석 자리가 막혀 있으면(천장 등) 탈 수 없다
  const [qx, qy] = seatPos(v, p);
  const c = CLASSES[p.cls];
  if (world.collidesAt(qx, qy, px(c.width), px(c.height), p.team)) return false;
  v.driver = p.id; p.vehicle = v.id;
  p.vx = 0; p.vy = 0; p.charge = 0; p.shield = false; p.attackWindup = 0;
  world.dropFlag(p); // 깃발은 들고 탈 수 없다
  const [sx, sy] = seatPos(v, p);
  p.x = sx; p.y = sy;
  world.events.push({ kind: 'mount', x: sx, y: sy, player: p.id });
  return true;
}

/** 내리기. 빈 자리(차체 위 → 좌/우)가 없으면 내리지 못한다 (force 면 차체 자리에 놓는다). 성공 시 true */
export function dismount(world: World, p: Player, kickVy: number, force = false): boolean {
  const v = findVehicle(world, p.vehicle);
  if (!v) { p.vehicle = 0; return true; }
  const c = CLASSES[p.cls];
  const pw = px(c.width), ph = px(c.height);
  const def = vehicleDef(v);
  const vw = px(def.width), vh = px(def.height);
  const cx = v.x + (vw >> 1) - (pw >> 1);
  const candidates: [number, number][] = [
    [cx, v.y - ph], [v.x - pw - 256, v.y + vh - ph], [v.x + vw + 256, v.y + vh - ph], [cx, v.y + vh - ph],
  ];
  let pos: [number, number] | undefined;
  for (const [x, y] of candidates) if (!world.collidesAt(x, y, pw, ph, p.team)) { pos = [x, y]; break; }
  if (!pos) { if (!force) return false; pos = [cx, v.y + vh - ph]; }
  p.vehicle = 0;
  if (v.driver === p.id) v.driver = 0;
  p.x = pos[0]; p.y = pos[1];
  p.vx = idiv(v.vx, 2); p.vy = -400 + kickVy; p.onGround = false;
  world.events.push({ kind: 'mount', x: p.x, y: p.y, player: p.id });
  return true;
}

/** 운전 중인 플레이어의 틱 처리 (물리/액션 대신) */
export function updateRider(world: World, p: Player, inp: Input): void {
  const v = findVehicle(world, p.vehicle);
  if (!v || v.driver !== p.id) { p.vehicle = 0; return; }
  p.aimX = inp.cx; p.aimY = inp.cy;
  if (p.hurtTimer > 0) p.hurtTimer--;
  if (p.attackTimer > 0) p.attackTimer--;
  const left = (inp.buttons & BTN_LEFT) !== 0, right = (inp.buttons & BTN_RIGHT) !== 0;
  if (left !== right) v.facing = left ? -1 : 1;
  p.facing = v.facing;
  const [sx, sy] = seatPos(v, p);
  p.x = sx; p.y = sy; p.vx = v.vx; p.vy = v.vy; p.onGround = true; p.onLadder = false;
  // 물속: 머리가 잠기면 숨이 줄고 익사 피해 (걷는 것과 같은 규칙)
  const c = CLASSES[p.cls];
  const headWater = world.map.waterAt(toTile(p.x + (px(c.width) >> 1)), toTile(p.y + 512)) >= WATER_MAX / 2;
  p.inWater = headWater;
  if (headWater) { if (--p.breath <= 0) { world.hurt(p, 1, 0, 0, 0); p.breath = 30; } } else p.breath = BREATH_TICKS;
}

export function updateVehicles(world: World): void {
  const arr = world.vehicles;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    const def = vehicleDef(v);
    const w = px(def.width), h = px(def.height);
    const driver = v.driver ? world.getPlayer(v.driver) : undefined;
    // 충돌 상자 = 차체 + (운전자가 있으면) 좌석의 운전자 상자 — 운전자가 천장에 끼지 않게
    const dc = driver ? CLASSES[driver.cls] : undefined;
    const seatOx = dc ? (w >> 1) + px(def.seatX) * v.facing - (px(dc.width) >> 1) : 0;
    const seatOy = dc ? (h >> 1) + px(def.seatY) - (px(dc.height) >> 1) : 0;
    const blocked = (x: number, y: number): boolean =>
      world.collidesAt(x, y, w, h, v.team) || (!!dc && world.collidesAt(x + seatOx, y + seatOy, px(dc.width), px(dc.height), v.team));
    // 운전자의 이번 틱 입력 (updatePlayer 가 lastInput 을 갱신한 뒤이므로 lastInput = 현재 틱 입력)
    const cur = driver?.lastInput;
    const left = cur ? (cur.buttons & BTN_LEFT) !== 0 : false;
    const right = cur ? (cur.buttons & BTN_RIGHT) !== 0 : false;
    // 물속: 느리고 무겁다
    const inWater = world.map.waterAt(toTile(v.x + (w >> 1)), toTile(v.y + (h >> 1))) >= WATER_MAX / 2;
    const maxSpeed = inWater ? idiv(def.maxSpeed, 3) : def.maxSpeed;
    if (inWater) v.vx = idiv(v.vx * 15, 16);
    // 가속/마찰 (접지 시)
    if (v.onGround) {
      if (left !== right) {
        const dir = left ? -1 : 1;
        v.vx = clamp(v.vx + dir * def.accel, -maxSpeed, maxSpeed);
      } else if (v.vx > 0) v.vx = imax(0, v.vx - def.friction);
      else if (v.vx < 0) v.vx = imin(0, v.vx + def.friction);
    }
    v.vy = imin(v.vy + GRAVITY, MAX_FALL);
    if (v.ramTimer > 0) v.ramTimer--;

    // 이동 + 충돌 + 계단 오르기
    let remX = v.vx, remY = v.vy;
    const wasGround = v.onGround;
    v.onGround = false;
    while (remX !== 0 || remY !== 0) {
      const sx = clamp(remX, -MAX_STEP, MAX_STEP), sy = clamp(remY, -MAX_STEP, MAX_STEP);
      remX -= sx; remY -= sy;
      if (sx !== 0) {
        const nx = v.x + sx;
        if (blocked(nx, v.y)) {
          // 접지 상태면 1칸 위로 올라가 본다 (계단)
          if (wasGround && !blocked(nx, v.y - TILE_FP) && !blocked(v.x, v.y - TILE_FP)) {
            v.y -= TILE_FP; v.x = nx;
          } else {
            v.x = sx > 0 ? (toTile(nx + w - 1) << TILE_SHIFT) - w : (toTile(nx) + 1) << TILE_SHIFT;
            v.vx = -idiv(v.vx, 4); remX = 0;
          }
        } else v.x = nx;
        v.odo += sx;
      }
      if (sy !== 0) {
        const ny = v.y + sy;
        if (blocked(v.x, ny)) {
          if (sy > 0) { v.y = (toTile(ny + h - 1) << TILE_SHIFT) - h; v.onGround = true; }
          else v.y = (toTile(ny) + 1) << TILE_SHIFT;
          v.vy = 0; remY = 0;
        } else v.y = ny;
      }
    }
    if (!v.onGround && v.vy >= 0 && blocked(v.x, v.y + 1)) v.onGround = true;
    // 접지 상태에서 지면이 아래로 내려가면 (계단 내려감) 바로 붙인다 — 통통 튀지 않게
    if (wasGround && !v.onGround && v.vy >= 0) {
      for (let d = 1; d <= 8; d++) {
        if (blocked(v.x, v.y + d * (TILE_FP >> 3) + 1)) { v.y += d * (TILE_FP >> 3); v.onGround = true; v.vy = 0; break; }
      }
    }

    // 기울기: 두 바퀴 아래 지면 높이 차
    const half = px(def.wheelBase) >> 1;
    const cx = v.x + (w >> 1);
    const gl = groundBelow(world, cx - half, v.y + h, v.team), gr = groundBelow(world, cx + half, v.y + h, v.team);
    const target = batan2(gr - gl, px(def.wheelBase));
    // 부드럽게 (1/4 씩 접근) — 정수
    let diff = target - v.angle;
    if (diff > 2048) diff -= 4096; else if (diff < -2048) diff += 4096;
    v.angle = (v.angle + idiv(diff, 4)) & 4095;

    // 들이받기
    if (iabs(v.vx) >= def.ramSpeed && v.ramTimer === 0) {
      for (const q of world.players) {
        if (q.state !== PlayerState.Alive || q.team === v.team || q.vehicle) continue;
        const c = CLASSES[q.cls];
        if (!aabbOverlap(v.x, v.y, w, h, q.x, q.y, px(c.width), px(c.height))) continue;
        world.hurt(q, def.ramDamage, v.driver, isign(v.vx) * def.ramKnockback, -500);
        v.ramTimer = 15;
        world.events.push({ kind: 'vhit', x: q.x, y: q.y, player: q.id });
      }
    }

    // 운전자를 이동 후 좌석에 다시 맞춘다 (한 틱 뒤처지지 않게)
    if (driver) { const [sx, sy] = seatPos(v, driver); driver.x = sx; driver.y = sy; driver.vx = v.vx; driver.vy = v.vy; }

    // 맵 밖 / 파괴
    if (v.y > (world.map.h << TILE_SHIFT) || v.hp <= 0) {
      destroyVehicle(world, v);
      arr.splice(i, 1); i--;
    }
  }
  // 파괴된 팀 탈것 재생성
  for (let team = 0; team < 2; team++) {
    const at = world.vehicleRespawnAt[team];
    if (at > 0 && world.tick >= at) { world.vehicleRespawnAt[team] = 0; spawnVehicle(world, team); }
  }
}

/** x 열에서 y 부터 아래로 최대 4칸 안의 첫 고체 타일 윗면(FP). 없으면 y+4칸 */
function groundBelow(world: World, x: number, y: number, team: number): number {
  const tx = toTile(x);
  let ty = toTile(y);
  for (let k = 0; k < 4; k++, ty++) if (world.map.solidFor(tx, ty, team)) return ty << TILE_SHIFT;
  return ty << TILE_SHIFT;
}

export function damageVehicle(world: World, v: Vehicle, dmg: number, by: number): void {
  v.hp -= dmg;
  world.events.push({ kind: 'vhit', x: v.x + (px(vehicleDef(v).width) >> 1), y: v.y, team: v.team, tile: dmg, by });
}

function destroyVehicle(world: World, v: Vehicle): void {
  const def = vehicleDef(v);
  const cx = v.x + (px(def.width) >> 1), cy = v.y + (px(def.height) >> 1);
  world.events.push({ kind: 'explode', x: cx, y: cy });
  if (v.driver) {
    const p = world.getPlayer(v.driver);
    if (p) { dismount(world, p, -600, true); world.hurt(p, 4, 0, 0, -600); }
  }
  world.vehicleRespawnAt[v.team] = world.tick + def.respawnTicks;
  // 잔해: 나무 드롭
  world.spawnDrop(0, 20, cx, cy, world.rng.range(-400, 400), -800);
}
