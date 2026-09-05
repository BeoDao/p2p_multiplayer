/**
 * 탈것 물리 (정수 결정론). World 에서 호출한다.
 * - 차체는 AABB 로 타일과 충돌하고 접지 상태에서 1칸(8px) 계단을 자동으로 오른다.
 * - 기울기는 앞/뒤 바퀴 아래 지면 높이 차로 구한다 (BAM). 포탑/좌석 위치 계산에도 쓰이므로 시뮬 상태의 일부.
 * - 운전자는 좌석에 고정되고, 운전자의 좌/우 입력이 가속이 된다. E 로 타고 내린다.
 * - 빠르게 달리며 적 플레이어와 겹치면 들이받기 피해.
 */
import { TILE_FP, TILE_SHIFT, px, toTile, clamp, iabs, isign, imin, imax, idiv, batan2, aabbOverlap, bsin, bcos, vlen } from './fixed';
import { CLASSES, VEHICLES, type VehicleDef } from '../data/defs';
import { BTN_LEFT, BTN_RIGHT, BTN_USE, BTN_ACTION1, type Input } from './input';
import { PlayerState, ProjKind, type Player, type Vehicle } from './types';
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
  return spawnVehicleAt(world, kind, team, (tx << TILE_SHIFT) + TILE_FP / 2 - (w >> 1), (ty << TILE_SHIFT) - h - TILE_FP, 0);
}

/** 지정 위치(좌상단 FP)에 탈것 생성 (건설형 포탑 등) */
export function spawnVehicleAt(world: World, kind: number, team: number, x: number, y: number, owner: number): Vehicle {
  const def = VEHICLES[kind];
  const v: Vehicle = {
    id: world.nextVehicleId++, kind, team, x, y,
    vx: 0, vy: 0, onGround: false, angle: 0, hp: def.hp, driver: 0, gunner: 0, facing: team === 0 ? 1 : -1, ramTimer: 0, odo: 0,
    owner, aim: team === 0 ? 0 : 2048, target: 0, aimTicks: 0,
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
    if (v.team !== p.team) continue;
    const def = vehicleDef(v);
    if (def.mountable === false) continue;
    if (v.driver !== 0 && (def.gunnerX === undefined || v.gunner !== 0)) continue; // 빈 자리 없음
    const vx = v.x + (px(def.width) >> 1), vy = v.y + (px(def.height) >> 1);
    const d = iabs(vx - cx) + iabs(vy - cy);
    if (d <= MOUNT_RANGE * 2 && (!best || d < bestD)) { best = v; bestD = d; }
  }
  return best;
}

/** 좌석 위치(플레이어 AABB 좌상단). 포수면 포수 자리 */
export function seatPos(v: Vehicle, p: Player): [number, number] {
  const def = vehicleDef(v), c = CLASSES[p.cls];
  const gunner = v.gunner === p.id && def.gunnerX !== undefined;
  const cx = v.x + (px(def.width) >> 1) + px(gunner ? def.gunnerX! : def.seatX) * v.facing;
  const cy = v.y + (px(def.height) >> 1) + px(gunner ? def.gunnerY! : def.seatY);
  return [cx - (px(c.width) >> 1), cy - (px(c.height) >> 1)];
}

/** 장갑 차량의 운전석(차체 안)에 탄 플레이어는 총알에 맞지 않는다 */
export function isShielded(world: World, p: Player): boolean {
  if (!p.vehicle) return false;
  const v = findVehicle(world, p.vehicle);
  return !!v && v.driver === p.id && !!vehicleDef(v).armor;
}

/** E 입력 처리: 타기/내리기. 처리했으면 true */
export function handleMount(world: World, p: Player, inp: Input): boolean {
  const use = (inp.buttons & BTN_USE) !== 0, usePrev = (p.lastInput.buttons & BTN_USE) !== 0;
  if (!use || usePrev) return false;
  if (p.vehicle) { dismount(world, p, 0); return true; } // 자리가 없으면 그대로 탄 채
  const v = nearestMountable(world, p);
  if (!v) return false;
  // 빈 자리: 운전석 우선, 아니면 포수석. 자리가 막혀 있으면(천장 등) 탈 수 없다
  const c = CLASSES[p.cls];
  const asGunner = v.driver !== 0;
  if (asGunner) v.gunner = p.id; else v.driver = p.id;
  p.vehicle = v.id;
  const [qx, qy] = seatPos(v, p);
  if (world.collidesAt(qx, qy, px(c.width), px(c.height), p.team)) { if (asGunner) v.gunner = 0; else v.driver = 0; p.vehicle = 0; return false; }
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
  if (v.gunner === p.id) v.gunner = 0;
  p.x = pos[0]; p.y = pos[1];
  p.vx = idiv(v.vx, 2); p.vy = -400 + kickVy; p.onGround = false;
  world.events.push({ kind: 'mount', x: p.x, y: p.y, player: p.id });
  return true;
}

/** 운전 중인 플레이어의 틱 처리 (물리/액션 대신) */
export function updateRider(world: World, p: Player, inp: Input): void {
  const v = findVehicle(world, p.vehicle);
  if (!v || (v.driver !== p.id && v.gunner !== p.id)) { p.vehicle = 0; return; }
  p.aimX = inp.cx; p.aimY = inp.cy;
  if (p.hurtTimer > 0) p.hurtTimer--;
  if (p.attackTimer > 0) p.attackTimer--;
  const def = vehicleDef(v);
  if (v.gunner === p.id) {
    // 포수: 커서 방향으로 기관총 (좌클릭 홀드)
    p.facing = inp.cx !== 0 ? isign(inp.cx) : v.facing;
    if (def.mg) {
      v.aim = batan2(inp.cy, inp.cx || p.facing);
      if ((inp.buttons & BTN_ACTION1) !== 0 && p.attackTimer === 0) {
        p.attackTimer = def.mg.rof;
        const c0 = CLASSES[p.cls];
        const gx = p.x + (px(c0.width) >> 1), gy = p.y + (px(c0.height) >> 1) - px(2);
        const ang = (v.aim + world.rng.range(-def.mg.spread, def.mg.spread)) & 4095;
        const mx = gx + idiv(bcos(v.aim) * px(def.mg.muzzle), 4096), my = gy + idiv(bsin(v.aim) * px(def.mg.muzzle), 4096);
        if (world.lineClear(v.team, gx, gy, mx, my)) {
          world.projectiles.push({
            id: world.nextProjId++, kind: ProjKind.Bullet, owner: p.id, team: p.team,
            x: mx, y: my, vx: idiv(bcos(ang) * def.mg.speed, 4096), vy: idiv(bsin(ang) * def.mg.speed, 4096),
            timer: 45, damage: def.mg.damage, stuck: false, attach: 0,
          });
          p.animEvent++;
          world.events.push({ kind: 'shoot', x: mx, y: my, player: p.id, tile: 1 });
        }
      }
    }
  } else {
    const left = (inp.buttons & BTN_LEFT) !== 0, right = (inp.buttons & BTN_RIGHT) !== 0;
    if (left !== right) v.facing = left ? -1 : 1;
    p.facing = v.facing;
    if (def.cannon) {
      // 전차 주포: 운전자가 커서 방향으로 좌클릭. 포탑에서 발사되는 폭발탄
      const cn = def.cannon;
      v.aim = batan2(inp.cy, inp.cx || v.facing);
      if ((inp.buttons & BTN_ACTION1) !== 0 && p.attackTimer === 0) {
        p.attackTimer = cn.rof;
        const tx = v.x + (px(def.width) >> 1), ty = v.y + (px(def.height) >> 1) + px(cn.turretY);
        const mx = tx + idiv(bcos(v.aim) * px(cn.muzzle), 4096), my = ty + idiv(bsin(v.aim) * px(cn.muzzle), 4096);
        if (world.lineClear(v.team, tx, ty, mx, my)) {
          world.projectiles.push({
            id: world.nextProjId++, kind: ProjKind.Shell, owner: p.id, team: p.team,
            x: mx, y: my, vx: idiv(bcos(v.aim) * cn.speed, 4096), vy: idiv(bsin(v.aim) * cn.speed, 4096),
            timer: cn.life, damage: cn.damage, stuck: false, attach: 0,
          });
          v.vx -= idiv(bcos(v.aim) * 120, 4096); // 반동
          p.animEvent++;
          world.events.push({ kind: 'shoot', x: mx, y: my, player: p.id, tile: 3 });
        }
      }
    }
  }
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
    const gunner = v.gunner ? world.getPlayer(v.gunner) : undefined;
    // 충돌 상자 = 차체 + (탑승자가 있으면) 좌석의 탑승자 상자 — 탑승자가 천장에 끼지 않게
    const dc = driver ? CLASSES[driver.cls] : undefined;
    const gc = gunner ? CLASSES[gunner.cls] : undefined;
    const seatOx = dc ? (w >> 1) + px(def.seatX) * v.facing - (px(dc.width) >> 1) : 0;
    const seatOy = dc ? (h >> 1) + px(def.seatY) - (px(dc.height) >> 1) : 0;
    const gunOx = gc ? (w >> 1) + px(def.gunnerX ?? 0) * v.facing - (px(gc.width) >> 1) : 0;
    const gunOy = gc ? (h >> 1) + px(def.gunnerY ?? 0) - (px(gc.height) >> 1) : 0;
    const blocked = (x: number, y: number): boolean =>
      world.collidesAt(x, y, w, h, v.team) || (!!dc && world.collidesAt(x + seatOx, y + seatOy, px(dc.width), px(dc.height), v.team))
      || (!!gc && world.collidesAt(x + gunOx, y + gunOy, px(gc.width), px(gc.height), v.team));
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

    // 자동 포탑
    if (def.turret) updateTurret(world, v, def);

    // 운전자를 이동 후 좌석에 다시 맞춘다 (한 틱 뒤처지지 않게)
    if (driver) { const [sx, sy] = seatPos(v, driver); driver.x = sx; driver.y = sy; driver.vx = v.vx; driver.vy = v.vy; }
    if (gunner) { const [sx, sy] = seatPos(v, gunner); gunner.x = sx; gunner.y = sy; gunner.vx = v.vx; gunner.vy = v.vy; }

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
  for (const pid of [v.driver, v.gunner]) {
    if (!pid) continue;
    const p = world.getPlayer(pid);
    if (p) { dismount(world, p, -600, true); world.hurt(p, 4, 0, 0, -600); }
  }
  if (def.respawnTicks > 0) world.vehicleRespawnAt[v.team] = world.tick + def.respawnTicks;
  // 잔해: 고철 드롭 (부수면 자원이 돌아온다)
  const scrap = def.scrap ?? { wood: 20 };
  if (scrap.wood) world.spawnDrop(0, scrap.wood, cx, cy, world.rng.range(-400, 400), -800);
  if (scrap.stone) world.spawnDrop(1, scrap.stone, cx, cy, world.rng.range(-400, 400), -700);
  if (scrap.iron) world.spawnDrop(2, scrap.iron, cx, cy, world.rng.range(-400, 400), -900);
}

/** 자동 포탑: 시선이 닿는 가장 가까운 적을 aimTicks 동안 조준한 뒤 rof 마다 발사. 표적을 잃으면 조준 초기화 */
function updateTurret(world: World, v: Vehicle, def: VehicleDef): void {
  const t = def.turret!;
  const w = px(def.width), h = px(def.height);
  const cx = v.x + (w >> 1), cy = v.y + (h >> 1) - px(1);
  const range = px(t.range);
  let best: Player | undefined, bestD = 0;
  for (const q of world.players) {
    if (q.state !== PlayerState.Alive || q.team === v.team) continue;
    const c = CLASSES[q.cls];
    const qx = q.x + (px(c.width) >> 1), qy = q.y + (px(c.height) >> 1);
    const d = vlen(qx - cx, qy - cy);
    if (d > range || (best && d >= bestD)) continue;
    if (!world.lineClear(v.team, cx, cy, qx, qy)) continue;
    best = q; bestD = d;
  }
  if (!best) { v.target = 0; v.aimTicks = 0; return; }
  const c = CLASSES[best.cls];
  const qx = best.x + (px(c.width) >> 1), qy = best.y + (px(c.height) >> 1);
  // 예측 없음, 대신 표적 방향으로 조준각을 서서히 돌린다
  const want = batan2(qy - cy, qx - cx);
  let diff = (want - v.aim) & 4095; if (diff > 2048) diff -= 4096;
  v.aim = (v.aim + clamp(diff, -120, 120)) & 4095;
  v.facing = qx >= cx ? 1 : -1;
  if (v.target !== best.id) { v.target = best.id; v.aimTicks = 0; }
  if (v.aimTicks < t.aimTicks) { v.aimTicks++; return; }
  if (v.ramTimer > 0) return;
  v.ramTimer = t.rof;
  const ang = (v.aim + world.rng.range(-t.spread, t.spread)) & 4095;
  const mx = cx + idiv(bcos(v.aim) * px(6), 4096), my = cy + idiv(bsin(v.aim) * px(6), 4096);
  world.projectiles.push({
    id: world.nextProjId++, kind: ProjKind.Bullet, owner: v.owner, team: v.team,
    x: mx, y: my, vx: idiv(bcos(ang) * t.speed, 4096), vy: idiv(bsin(ang) * t.speed, 4096),
    timer: 40, damage: t.damage, stuck: false, attach: 0,
  });
  world.events.push({ kind: 'shoot', x: mx, y: my, player: v.owner, tile: 1 });
}
