/**
 * 월드 스냅샷 직렬화. 늦게 참가한 피어에게 전체 상태를 전달하고, 주기적 해시 비교로 디싱크를 검출한다.
 * 포맷은 리틀엔디언 고정 배열. 문자열은 u8 길이 + UTF-8.
 */
import { World } from './world';
import { TileMap } from './tilemap';
import { PlayerState, ProjKind, type Player, type Projectile, type Flag, type Drop, type Vehicle } from './types';
import { EMPTY_INPUT } from './input';
import { Rng, fnv1a } from './rng';

const enc = new TextEncoder();
const dec = new TextDecoder();

class Writer {
  buf: Uint8Array;
  view: DataView;
  pos = 0;
  constructor(cap: number) {
    this.buf = new Uint8Array(cap);
    this.view = new DataView(this.buf.buffer);
  }
  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    const nb = new Uint8Array(Math.max(this.buf.length * 2, this.pos + n));
    nb.set(this.buf);
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }
  u8(v: number): void { this.ensure(1); this.buf[this.pos++] = v & 0xff; }
  i32(v: number): void { this.ensure(4); this.view.setInt32(this.pos, v | 0, true); this.pos += 4; }
  bool(v: boolean): void { this.u8(v ? 1 : 0); }
  str(s: string): void {
    const b = enc.encode(s.slice(0, 32));
    this.u8(b.length);
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  bytes(b: Uint8Array): void {
    this.i32(b.length);
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  done(): Uint8Array { return this.buf.slice(0, this.pos); }
}

class Reader {
  view: DataView;
  pos = 0;
  constructor(public buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8(): number { return this.buf[this.pos++]; }
  i32(): number { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  bool(): boolean { return this.u8() !== 0; }
  str(): string { const n = this.u8(); const s = dec.decode(this.buf.subarray(this.pos, this.pos + n)); this.pos += n; return s; }
  bytes(): Uint8Array { const n = this.i32(); const b = this.buf.slice(this.pos, this.pos + n); this.pos += n; return b; }
}

function writePlayer(w: Writer, p: Player): void {
  w.i32(p.id); w.str(p.name); w.u8(p.team); w.u8(p.cls); w.u8(p.state); w.i32(p.respawnAt);
  w.i32(p.x); w.i32(p.y); w.i32(p.vx); w.i32(p.vy);
  w.bool(p.onGround); w.bool(p.onLadder); w.bool(p.inWater); w.i32(p.breath); w.i32(p.facing); w.i32(p.aimX); w.i32(p.aimY);
  w.i32(p.hp); w.u8(p.slot); w.i32(p.attackTimer); w.i32(p.attackWindup); w.i32(p.charge); w.bool(p.shield);
  w.i32(p.bombs); w.i32(p.arrows); w.i32(p.wood); w.i32(p.stone); w.i32(p.gold);
  w.i32(p.carryingFlag); w.i32(p.kills); w.i32(p.deaths);
  w.u8(p.lastInput.buttons); w.i32(p.lastInput.cx); w.i32(p.lastInput.cy); w.u8(p.lastInput.slot); w.u8(p.lastInput.cls);
  w.i32(p.hurtTimer); w.i32(p.animEvent); w.u8(p.digMode); w.u8(p.digCheat); w.i32(p.vehicle);
}
function readPlayer(r: Reader): Player {
  return {
    id: r.i32(), name: r.str(), team: r.u8(), cls: r.u8(), state: r.u8() as PlayerState, respawnAt: r.i32(),
    x: r.i32(), y: r.i32(), vx: r.i32(), vy: r.i32(),
    onGround: r.bool(), onLadder: r.bool(), inWater: r.bool(), breath: r.i32(), facing: r.i32(), aimX: r.i32(), aimY: r.i32(),
    hp: r.i32(), slot: r.u8(), attackTimer: r.i32(), attackWindup: r.i32(), charge: r.i32(), shield: r.bool(),
    bombs: r.i32(), arrows: r.i32(), wood: r.i32(), stone: r.i32(), gold: r.i32(),
    carryingFlag: r.i32(), kills: r.i32(), deaths: r.i32(),
    lastInput: { buttons: r.u8(), cx: r.i32(), cy: r.i32(), slot: r.u8(), cls: r.u8() },
    hurtTimer: r.i32(), animEvent: r.i32(), digMode: r.u8(), digCheat: r.u8(), vehicle: r.i32(),
  };
}
function writeProj(w: Writer, p: Projectile): void {
  w.i32(p.id); w.u8(p.kind); w.i32(p.owner); w.u8(p.team); w.i32(p.x); w.i32(p.y); w.i32(p.vx); w.i32(p.vy);
  w.i32(p.timer); w.i32(p.damage); w.bool(p.stuck);
}
function readProj(r: Reader): Projectile {
  return {
    id: r.i32(), kind: r.u8() as ProjKind, owner: r.i32(), team: r.u8(), x: r.i32(), y: r.i32(), vx: r.i32(), vy: r.i32(),
    timer: r.i32(), damage: r.i32(), stuck: r.bool(),
  };
}
function writeFlag(w: Writer, f: Flag): void {
  w.u8(f.team); w.i32(f.homeX); w.i32(f.homeY); w.i32(f.x); w.i32(f.y); w.i32(f.carrier); w.bool(f.atHome); w.i32(f.returnTimer);
}
function writeDrop(w: Writer, d: Drop): void {
  w.i32(d.id); w.u8(d.kind); w.i32(d.amount); w.i32(d.x); w.i32(d.y); w.i32(d.vx); w.i32(d.vy); w.i32(d.life);
}
function readDrop(r: Reader): Drop {
  return { id: r.i32(), kind: r.u8(), amount: r.i32(), x: r.i32(), y: r.i32(), vx: r.i32(), vy: r.i32(), life: r.i32() };
}
function writeVehicle(w: Writer, v: Vehicle): void {
  w.i32(v.id); w.u8(v.kind); w.u8(v.team); w.i32(v.x); w.i32(v.y); w.i32(v.vx); w.i32(v.vy); w.bool(v.onGround);
  w.i32(v.angle); w.i32(v.hp); w.i32(v.driver); w.i32(v.facing); w.i32(v.ramTimer); w.i32(v.odo);
}
function readVehicle(r: Reader): Vehicle {
  return { id: r.i32(), kind: r.u8(), team: r.u8(), x: r.i32(), y: r.i32(), vx: r.i32(), vy: r.i32(), onGround: r.bool(), angle: r.i32(), hp: r.i32(), driver: r.i32(), facing: r.i32(), ramTimer: r.i32(), odo: r.i32() };
}
function readFlag(r: Reader): Flag {
  return { team: r.u8(), homeX: r.i32(), homeY: r.i32(), x: r.i32(), y: r.i32(), carrier: r.i32(), atHome: r.bool(), returnTimer: r.i32() };
}

export function serializeWorld(world: World): Uint8Array {
  const w = new Writer(world.map.w * world.map.h * 3 + 4096);
  w.i32(0x4b414732); // 'KAG2'
  w.i32(world.seed); w.i32(world.rng.state); w.i32(world.tick); w.i32(world.round); w.i32(world.roundOverAt);
  w.i32(world.nextPlayerId); w.i32(world.nextProjId);
  w.i32(world.score[0]); w.i32(world.score[1]);
  w.i32(world.spawnX[0]); w.i32(world.spawnX[1]);
  w.i32(world.map.w); w.i32(world.map.h);
  w.bytes(world.map.type); w.bytes(world.map.hp); w.bytes(world.map.team);
  w.bytes(world.map.backType); w.bytes(world.map.backHp); w.bytes(world.map.water);
  w.i32(world.players.length);
  for (const p of world.players) writePlayer(w, p);
  w.i32(world.projectiles.length);
  for (const p of world.projectiles) writeProj(w, p);
  w.i32(world.flags.length);
  for (const f of world.flags) writeFlag(w, f);
  w.i32(world.collapses.length);
  for (const v of world.collapses) w.i32(v);
  w.i32(world.drops.length);
  for (const d of world.drops) writeDrop(w, d);
  w.i32(world.nextDropId);
  w.i32(world.vehicles.length);
  for (const v of world.vehicles) writeVehicle(w, v);
  w.i32(world.nextVehicleId); w.i32(world.vehicleRespawnAt[0]); w.i32(world.vehicleRespawnAt[1]);
  return w.done();
}

export function deserializeWorld(buf: Uint8Array): World {
  const r = new Reader(buf);
  if (r.i32() !== 0x4b414732) throw new Error('bad snapshot');
  const seed = r.i32();
  const rngState = r.i32();
  const tick = r.i32(), round = r.i32(), roundOverAt = r.i32();
  const nextPlayerId = r.i32(), nextProjId = r.i32();
  const s0 = r.i32(), s1 = r.i32();
  const sp0 = r.i32(), sp1 = r.i32();
  const mw = r.i32(), mh = r.i32();
  // 맵 생성을 건너뛰기 위해 빈 월드를 만든 뒤 덮어쓴다
  const world = Object.create(World.prototype) as World;
  (world as { seed: number }).seed = seed;
  world.rng = new Rng(seed);
  world.rng.state = rngState;
  world.tick = tick; world.round = round; world.roundOverAt = roundOverAt;
  world.nextPlayerId = nextPlayerId; world.nextProjId = nextProjId;
  world.score = new Int32Array([s0, s1]);
  world.spawnX = [sp0, sp1];
  const map = new TileMap(mw, mh);
  map.type.set(r.bytes()); map.hp.set(r.bytes()); map.team.set(r.bytes());
  map.backType.set(r.bytes()); map.backHp.set(r.bytes()); map.water.set(r.bytes());
  map.dirty = [-1];
  world.map = map;
  world.players = [];
  const np = r.i32();
  for (let i = 0; i < np; i++) world.players.push(readPlayer(r));
  world.projectiles = [];
  const npr = r.i32();
  for (let i = 0; i < npr; i++) world.projectiles.push(readProj(r));
  world.flags = [];
  const nf = r.i32();
  for (let i = 0; i < nf; i++) world.flags.push(readFlag(r));
  world.collapses = [];
  const nc = r.i32();
  for (let i = 0; i < nc; i++) world.collapses.push(r.i32());
  world.drops = [];
  const nd = r.i32();
  for (let i = 0; i < nd; i++) world.drops.push(readDrop(r));
  world.nextDropId = r.i32();
  world.vehicles = [];
  const nv = r.i32();
  for (let i = 0; i < nv; i++) world.vehicles.push(readVehicle(r));
  world.nextVehicleId = r.i32(); world.vehicleRespawnAt = [r.i32(), r.i32()];
  world.events = [];
  return world;
}

/** 상태 해시 (디싱크 검출). 전체 직렬화 후 FNV-1a. */
export function hashWorld(world: World): number {
  return fnv1a(serializeWorld(world));
}

export { EMPTY_INPUT };
