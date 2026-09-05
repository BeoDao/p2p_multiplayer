/**
 * 월드 스냅샷 직렬화. 늦게 참가한 피어에게 전체 상태를 전달하고, 주기적 해시 비교로 디싱크를 검출한다.
 * 엔티티 필드는 아래 스키마 표로만 정의한다 — 새 필드를 추가하면 표에 한 줄 넣는 것으로 write/read/hash 가 모두 맞는다.
 * (빠뜨리면 tests/schema.test.ts 가 실패한다.)
 */
import { World } from './world';
import { TileMap } from './tilemap';
import type { Player, Projectile, Flag, Drop, Vehicle } from './types';
import { EMPTY_INPUT } from './input';
import { Rng, fnv1a } from './rng';
import { Writer, Reader, type Schema } from './schema';

const MAGIC = 0x52574231; // 'RWB1' (Rubblewar snapshot v1)

export const INPUT_SCHEMA: Schema = [
  ['buttons', 'u8'], ['cx', 'i32'], ['cy', 'i32'], ['slot', 'u8'], ['cls', 'u8'], ['cheat', 'u8'], ['a0', 'i32'], ['a1', 'i32'],
];
export const PLAYER_SCHEMA: Schema = [
  ['id', 'i32'], ['name', 'str'], ['team', 'u8'], ['cls', 'u8'], ['state', 'u8'], ['respawnAt', 'i32'],
  ['x', 'i32'], ['y', 'i32'], ['vx', 'i32'], ['vy', 'i32'],
  ['onGround', 'bool'], ['onLadder', 'bool'], ['inWater', 'bool'], ['breath', 'i32'], ['facing', 'i32'], ['aimX', 'i32'], ['aimY', 'i32'],
  ['hp', 'i32'], ['slot', 'u8'], ['attackTimer', 'i32'], ['attackWindup', 'i32'], ['charge', 'i32'], ['shield', 'bool'],
  ['bombs', 'i32'], ['arrows', 'i32'], ['wood', 'i32'], ['stone', 'i32'], ['iron', 'i32'],
  ['carryingFlag', 'i32'], ['kills', 'i32'], ['deaths', 'i32'],
  ['lastInput', { obj: INPUT_SCHEMA }],
  ['hurtTimer', 'i32'], ['animEvent', 'i32'], ['digMode', 'u8'], ['digCheat', 'u8'], ['vehicle', 'i32'], ['god', 'u8'], ['jumpTicks', 'u8'],
  ['ammo', 'i32'], ['mag', 'i32'], ['reload', 'i32'], ['spread', 'i32'], ['c4', 'i32'], ['drones', 'i32'], ['mines', 'i32'], ['scope', 'i32'], ['spotTimer', 'i32'],
];
export const PROJECTILE_SCHEMA: Schema = [
  ['id', 'i32'], ['kind', 'u8'], ['owner', 'i32'], ['team', 'u8'], ['x', 'i32'], ['y', 'i32'], ['vx', 'i32'], ['vy', 'i32'],
  ['timer', 'i32'], ['damage', 'i32'], ['stuck', 'bool'], ['attach', 'i32'],
];
export const FLAG_SCHEMA: Schema = [
  ['team', 'u8'], ['homeX', 'i32'], ['homeY', 'i32'], ['x', 'i32'], ['y', 'i32'], ['carrier', 'i32'], ['atHome', 'bool'], ['returnTimer', 'i32'],
];
export const DROP_SCHEMA: Schema = [
  ['id', 'i32'], ['kind', 'u8'], ['amount', 'i32'], ['x', 'i32'], ['y', 'i32'], ['vx', 'i32'], ['vy', 'i32'], ['life', 'i32'],
];
export const VEHICLE_SCHEMA: Schema = [
  ['id', 'i32'], ['kind', 'u8'], ['team', 'u8'], ['x', 'i32'], ['y', 'i32'], ['vx', 'i32'], ['vy', 'i32'], ['onGround', 'bool'],
  ['angle', 'i32'], ['hp', 'i32'], ['driver', 'i32'], ['gunner', 'i32'], ['facing', 'i32'], ['ramTimer', 'i32'], ['odo', 'i32'], ['owner', 'i32'], ['aim', 'i32'], ['target', 'i32'], ['aimTicks', 'i32'],
];
/** World 의 스칼라 상태 (배열/맵 제외). 순서 = 바이트 순서 */
export const WORLD_SCALARS: Schema = [
  ['seed', 'i32'], ['tick', 'i32'], ['round', 'i32'], ['roundOverAt', 'i32'],
  ['nextPlayerId', 'i32'], ['nextProjId', 'i32'], ['nextDropId', 'i32'], ['nextVehicleId', 'i32'], ['nextDummyId', 'i32'],
];
/** World 의 배열/맵 필드 — 스키마 테스트에서 "누락된 필드" 검사 시 제외 목록의 근거 */
export const WORLD_COLLECTIONS = ['rng', 'map', 'players', 'projectiles', 'flags', 'drops', 'vehicles', 'score', 'spawnX', 'collapses', 'vehicleRespawnAt', 'events'];

function writeList<T extends object>(w: Writer, schema: Schema, list: T[]): void {
  w.i32(list.length);
  for (const o of list) w.obj(schema, o);
}
function readList<T extends object>(r: Reader, schema: Schema): T[] {
  const n = r.i32();
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(r.obj<T>(schema));
  return out;
}

export function serializeWorld(world: World): Uint8Array {
  const w = new Writer(world.map.w * world.map.h * 3 + 4096);
  w.i32(MAGIC);
  w.obj(WORLD_SCALARS, world);
  w.i32(world.rng.state);
  w.i32(world.score[0]); w.i32(world.score[1]);
  w.i32(world.spawnX[0]); w.i32(world.spawnX[1]);
  w.i32(world.vehicleRespawnAt[0]); w.i32(world.vehicleRespawnAt[1]);
  w.i32(world.map.w); w.i32(world.map.h);
  w.bytes(world.map.type); w.bytes(world.map.hp); w.bytes(world.map.team);
  w.bytes(world.map.backType); w.bytes(world.map.backHp); w.bytes(world.map.water);
  writeList(w, PLAYER_SCHEMA, world.players);
  writeList(w, PROJECTILE_SCHEMA, world.projectiles);
  writeList(w, FLAG_SCHEMA, world.flags);
  writeList(w, DROP_SCHEMA, world.drops);
  writeList(w, VEHICLE_SCHEMA, world.vehicles);
  w.i32(world.collapses.length);
  for (const v of world.collapses) w.i32(v);
  return w.done();
}

export function deserializeWorld(buf: Uint8Array): World {
  const r = new Reader(buf);
  if (r.i32() !== MAGIC) throw new Error('bad snapshot');
  const scalars = r.obj<Record<string, number>>(WORLD_SCALARS);
  // 맵 생성을 건너뛰기 위해 빈 월드를 만든 뒤 덮어쓴다
  const world = Object.create(World.prototype) as World;
  Object.assign(world, scalars);
  world.rng = new Rng(scalars.seed);
  world.rng.state = r.i32();
  world.score = new Int32Array([r.i32(), r.i32()]);
  world.spawnX = [r.i32(), r.i32()];
  world.vehicleRespawnAt = [r.i32(), r.i32()];
  const mw = r.i32(), mh = r.i32();
  const map = new TileMap(mw, mh);
  map.type.set(r.bytes()); map.hp.set(r.bytes()); map.team.set(r.bytes());
  map.backType.set(r.bytes()); map.backHp.set(r.bytes()); map.water.set(r.bytes());
  map.dirty = [-1];
  world.map = map;
  world.players = readList<Player>(r, PLAYER_SCHEMA);
  world.projectiles = readList<Projectile>(r, PROJECTILE_SCHEMA);
  world.flags = readList<Flag>(r, FLAG_SCHEMA);
  world.drops = readList<Drop>(r, DROP_SCHEMA);
  world.vehicles = readList<Vehicle>(r, VEHICLE_SCHEMA);
  world.collapses = [];
  const nc = r.i32();
  for (let i = 0; i < nc; i++) world.collapses.push(r.i32());
  world.events = [];
  return world;
}

/** 상태 해시 (디싱크 검출). 전체 직렬화 후 FNV-1a. */
export function hashWorld(world: World): number {
  return fnv1a(serializeWorld(world));
}

export { EMPTY_INPUT };
