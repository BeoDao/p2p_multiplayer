/**
 * PixiJS 렌더러. 시뮬 상태(정수)를 읽어 화면에 그린다. 시뮬을 절대 변경하지 않는다.
 * - 타일: 32x32 타일 청크를 RenderTexture 로 캐시, 변경된 청크만 다시 그림
 * - 플레이어: Skeleton (2D 스켈레탈)
 * - 틱 사이 보간으로 60fps 이상에서 부드럽게 표시
 */
import { Application, Container, Sprite, Graphics, RenderTexture, Text, type Texture } from 'pixi.js';
import { tileId } from '../data/defs';
import { World, THROW_CHARGE_TICKS } from '../sim/world';
import { WATER_MAX } from '../sim/tilemap';
import { PlayerState, ProjKind, type Player, type Vehicle, type WorldEvent } from '../sim/types';
import { VEHICLES, CLASSES, TILE_TABLE, hotbarItem, T_AIR } from '../data/defs';
import { FP_ONE, TILE_PX } from '../sim/fixed';
import { Skeleton, TEAM_COLORS } from './skeleton';
import { TextureRegistry } from './textures';

const CHUNK = 32;
const ZOOM_DEFAULT = 3;

interface VehicleView {
  root: Container; body: Sprite; wheels: Sprite[]; hp: Graphics;
  prevX: number; prevY: number; curX: number; curY: number; prevAng: number; curAng: number;
}

interface PlayerView {
  skel: Skeleton;
  name: Text;
  hp: Graphics;
  prevX: number; prevY: number; curX: number; curY: number;
  lastAnimEvent: number;
  cls: number; team: number;
  weaponKey: string;
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; sp: Sprite }

/** 어깨(armF 본 원점)가 몸 중앙보다 위에 있는 px — skeleton.json: hip -7, armF -4.5 → 발 위 11.5, 중앙 7 */
const SHOULDER_ABOVE_CENTER = 4.5;

/** 드롭 종류(DropKind 순서) → 파츠/색/아이콘 */
const DROP_PARTS = ['drop_wood', 'drop_stone', 'drop_gold', 'drop_bomb', 'drop_arrow'];
const DROP_COLORS = [0xa8763e, 0xaaaaaa, 0xffd040, 0x606060, 0xe8e8e8];
const DROP_ICONS = ['🪵', '🪨', '🪙', '💣', '🏹'];

export class Renderer {
  worldLayer = new Container();
  private tileLayer = new Container();
  private bgTileLayer = new Container();
  private entityLayer = new Container();
  private fxLayer = new Container();
  private uiLayer = new Container();
  private chunks: { sp: Sprite; rt: RenderTexture; dirty: boolean }[] = [];
  private chunksX = 0; private chunksY = 0;
  private players = new Map<number, PlayerView>();
  private projSprites = new Map<number, Sprite>();
  private vehicleViews = new Map<number, VehicleView>();
  private flagSprites: Sprite[] = [];
  private dropSprites = new Map<number, Sprite>();
  private particles: Particle[] = [];
  private cursor = new Graphics();
  private ghost = new Sprite();
  private floaters: { t: Text; vy: number; life: number }[] = [];
  private waterGfx = new Graphics();
  private lastTick = -1;
  private mapRef: World['map'] | null = null;
  camX = 0; camY = 0; zoom = ZOOM_DEFAULT;
  private shake = 0; // 남은 흔들림 세기(px)
  private shakeSeed = 0;
  /** 월드 이벤트 구독 (효과음, 킬 피드 등) */
  eventSink: ((e: WorldEvent) => void) | null = null;

  constructor(public app: Application, public tex: TextureRegistry) {
    this.worldLayer.addChild(this.bgTileLayer, this.tileLayer, this.entityLayer, this.fxLayer, this.uiLayer);
    this.entityLayer.sortableChildren = true;
    this.uiLayer.addChild(this.cursor);
    this.ghost.alpha = 0.45; this.ghost.visible = false;
    this.uiLayer.addChild(this.ghost);
    this.fxLayer.addChild(this.waterGfx);
    app.stage.addChild(this.worldLayer);
    app.renderer.background.color = 0x6fa8dc;
  }

  attachWorld(world: World): void {
    this.mapRef = world.map;
    for (const c of this.chunks) { c.sp.destroy(); c.rt.destroy(true); }
    this.chunks = [];
    this.chunksX = Math.ceil(world.map.w / CHUNK);
    this.chunksY = Math.ceil(world.map.h / CHUNK);
    for (let cy = 0; cy < this.chunksY; cy++)
      for (let cx = 0; cx < this.chunksX; cx++) {
        const rt = RenderTexture.create({ width: CHUNK * TILE_PX, height: CHUNK * TILE_PX, scaleMode: 'nearest' });
        const sp = new Sprite(rt);
        sp.position.set(cx * CHUNK * TILE_PX, cy * CHUNK * TILE_PX);
        this.tileLayer.addChild(sp);
        this.chunks.push({ sp, rt, dirty: true });
      }
    for (const v of this.players.values()) { v.skel.root.destroy(); v.name.destroy(); v.hp.destroy(); }
    this.players.clear();
    for (const s of this.projSprites.values()) s.destroy();
    this.projSprites.clear();
    for (const v of this.vehicleViews.values()) v.root.destroy({ children: true });
    this.vehicleViews.clear();
    for (const f of this.flagSprites) f.destroy();
    this.flagSprites = [];
    for (const d of this.dropSprites.values()) d.destroy();
    this.dropSprites.clear();
    this.lastTick = -1;
  }

  // ---------- 타일 ----------
  private rebuildChunk(world: World, ci: number): void {
    const c = this.chunks[ci];
    const cx = ci % this.chunksX, cy = (ci / this.chunksX) | 0;
    const cont = new Container();
    const map = world.map;
    for (let ty = 0; ty < CHUNK; ty++) {
      const y = cy * CHUNK + ty;
      if (y >= map.h) break;
      for (let tx = 0; tx < CHUNK; tx++) {
        const x = cx * CHUNK + tx;
        if (x >= map.w) break;
        const i = y * map.w + x;
        const bt = map.backType[i];
        if (bt !== T_AIR) {
          const bdef = TILE_TABLE[bt];
          const btex = bdef.texture ? this.tex.tile(bdef.texture, (x * 5 + y * 11) & 3) : undefined;
          if (btex) {
            const bs = new Sprite(btex);
            bs.position.set(tx * TILE_PX, ty * TILE_PX);
            const f = bdef.hp > 0 ? map.backHp[i] / bdef.hp : 1;
            const g = Math.round(255 * (0.5 + 0.5 * f));
            bs.tint = ((g * 0.6) << 16) | ((g * 0.6) << 8) | ((g * 0.7) | 0);
            cont.addChild(bs);
          }
        }
        const t = map.type[i];
        if (t === T_AIR) continue;
        const def = TILE_TABLE[t];
        if (!def.texture) continue;
        const texv = this.tex.tile(def.texture, (x * 7 + y * 13) & 3);
        if (!texv) continue;
        const sp = new Sprite(texv);
        sp.position.set(tx * TILE_PX, ty * TILE_PX);
        if (def.hp > 0) {
          const hp = map.hp[i];
          if (hp < def.hp) {
            const g = Math.round(255 * (0.45 + 0.55 * (hp / def.hp)));
            sp.tint = (g << 16) | (g << 8) | g;
          }
        }
        if (def.door) {
          const team = map.team[i];
          if (team < 2) sp.tint = team === 0 ? 0x9ab0ff : 0xffa0a0;
        }
        cont.addChild(sp);
        // 자동 타일링: 고체 타일의 노출된 면에 어두운 테두리(1px) — 흙/돌 덩어리의 윤곽이 드러남
        if (def.solid && !def.door) {
          const exposed = (nx: number, ny: number): boolean => map.inBounds(nx, ny) && !map.isSolid(nx, ny);
          const eh = this.tex.part('edge_h'), ev = this.tex.part('edge_v');
          const add = (t: Texture, ox: number, oy: number) => { const e = new Sprite(t); e.position.set(tx * TILE_PX + ox, ty * TILE_PX + oy); e.alpha = 0.45; cont.addChild(e); };
          if (exposed(x, y - 1)) add(eh, 0, 0);
          if (exposed(x, y + 1)) add(eh, 0, TILE_PX - 1);
          if (exposed(x - 1, y)) add(ev, 0, 0);
          if (exposed(x + 1, y)) add(ev, TILE_PX - 1, 0);
        }
      }
    }
    this.app.renderer.render({ container: cont, target: c.rt, clear: true });
    cont.destroy({ children: true });
    c.dirty = false;
  }

  private flushDirty(world: World): void {
    const map = world.map;
    if (map !== this.mapRef) this.attachWorld(world);
    if (map.dirty.length > 0) {
      if (map.dirty.includes(-1)) for (const c of this.chunks) c.dirty = true;
      else for (const i of map.dirty) {
        const x = i % map.w, y = (i / map.w) | 0;
        // 테두리는 이웃 타일에 의존하므로 청크 경계에서는 이웃 청크도 다시 그린다
        for (let k = 0; k < 5; k++) {
          const nx = x + (k === 1 ? -1 : k === 2 ? 1 : 0), ny = y + (k === 3 ? -1 : k === 4 ? 1 : 0);
          const ci = ((ny / CHUNK) | 0) * this.chunksX + ((nx / CHUNK) | 0);
          if (nx >= 0 && ny >= 0 && nx < map.w && ny < map.h && this.chunks[ci]) this.chunks[ci].dirty = true;
        }
      }
      map.dirty.length = 0;
    }
    for (let i = 0; i < this.chunks.length; i++) if (this.chunks[i].dirty) this.rebuildChunk(world, i);
  }

  // ---------- 탈것 ----------
  private getVehicleView(veh: Vehicle): VehicleView {
    let v = this.vehicleViews.get(veh.id);
    if (v) return v;
    const def = VEHICLES[veh.kind];
    const root = new Container();
    root.zIndex = 8;
    const body = new Sprite(this.tex.part('cart_body'));
    body.anchor.set(0.5, 0.5);
    body.tint = veh.team === 0 ? 0xb9c8ff : 0xffb9b9;
    const wheels: Sprite[] = [];
    for (const sx of [-1, 1]) {
      const wsp = new Sprite(this.tex.part('wheel'));
      wsp.anchor.set(0.5, 0.5);
      wsp.position.set(sx * def.wheelBase / 2, def.height / 2 - 1);
      wheels.push(wsp);
      root.addChild(wsp);
    }
    root.addChild(body);
    const hp = new Graphics();
    root.addChild(hp);
    this.entityLayer.addChild(root);
    v = { root, body, wheels, hp, prevX: veh.x, prevY: veh.y, curX: veh.x, curY: veh.y, prevAng: veh.angle, curAng: veh.angle };
    this.vehicleViews.set(veh.id, v);
    return v;
  }

  // ---------- 플레이어 ----------
  private getPlayerView(p: Player): PlayerView {
    let v = this.players.get(p.id);
    if (v) return v;
    const skel = new Skeleton(this.tex);
    const cls = CLASSES[p.cls];
    skel.setSkin(cls.skin, {}, p.team);
    const name = new Text({ text: p.name, style: { fontFamily: 'monospace', fontSize: 6, fill: TEAM_COLORS[p.team], stroke: { color: 0x000000, width: 1 } }, resolution: 4 });
    name.anchor.set(0.5, 1);
    const hp = new Graphics();
    this.entityLayer.addChild(skel.root, name, hp);
    skel.root.zIndex = 10; name.zIndex = 20; hp.zIndex = 20;
    v = { skel, name, hp, prevX: p.x, prevY: p.y, curX: p.x, curY: p.y, lastAnimEvent: p.animEvent, cls: p.cls, team: p.team, weaponKey: '' };
    this.players.set(p.id, v);
    return v;
  }

  private updatePlayer(world: World, p: Player, v: PlayerView, alpha: number, dtTicks: number, isLocal: boolean): void {
    const cls = CLASSES[p.cls];
    if (v.cls !== p.cls || v.team !== p.team) {
      v.skel.setSkin(cls.skin, {}, p.team);
      v.cls = p.cls; v.team = p.team; v.weaponKey = '';
      v.name.style.fill = TEAM_COLORS[p.team];
    }
    const w = cls.width, h = cls.height;
    const x = (v.prevX + (v.curX - v.prevX) * alpha) / FP_ONE;
    const y = (v.prevY + (v.curY - v.prevY) * alpha) / FP_ONE;
    const skel = v.skel;
    skel.root.position.set(x + w / 2, y + h); // root = 발
    skel.root.visible = p.state === PlayerState.Alive;
    v.name.visible = p.state === PlayerState.Alive;
    v.hp.visible = p.state === PlayerState.Alive && p.hp < cls.hp;
    if (p.state !== PlayerState.Alive) { skel.play('dead'); return; }
    v.name.position.set(x + w / 2, y - 6);
    // HP 바 + 활 당김 게이지
    v.hp.clear();
    const item0 = hotbarItem(cls, p.slot);
    const chargeMax = item0?.id === 'bow' ? cls.bow?.chargeTicks ?? 1 : THROW_CHARGE_TICKS;
    const charging = p.charge > 0;
    v.hp.visible = v.hp.visible || charging;
    if (p.hp < cls.hp) {
      v.hp.rect(x + w / 2 - 5, y - 4, 10, 1.5).fill(0x000000);
      v.hp.rect(x + w / 2 - 5, y - 4, (10 * p.hp) / cls.hp, 1.5).fill(p.team === 0 ? 0x66aaff : 0xff6666);
    }
    if (charging) {
      const f = p.charge / chargeMax;
      const full = p.charge >= chargeMax;
      v.hp.rect(x + w / 2 - 6, y - 7, 12, 2).fill(0x000000);
      v.hp.rect(x + w / 2 - 6, y - 7, 12 * f, 2).fill(full ? 0xffe066 : p.charge >= 4 ? 0xffffff : 0x888888);
    }
    // 무기 파츠
    const item = hotbarItem(cls, p.slot);
    const key = item ? (item.kind === 'weapon' ? item.part ?? 'none' : 'tile:' + item.tile) : 'none';
    if (key !== v.weaponKey) {
      v.weaponKey = key;
      if (key.startsWith('tile:')) {
        const t = this.tex.tile(key.slice(5), 0);
        if (t) skel.setPartTextureObj('weapon', t); else skel.setPartTexture('weapon', 'none');
      } else skel.setPartTexture('weapon', key);
      skel.setPartOffset('weapon', item?.rot ?? 0, item?.ox ?? 0, item?.oy ?? 0);
    }
    // 애니메이션 선택
    skel.facing = p.facing;
    const moving = Math.abs(p.vx) > 40;
    let clip = 'idle';
    if (p.vehicle) clip = 'idle';
    else if (p.onLadder && !p.onGround) clip = 'climb';
    else if (!p.onGround) clip = p.vy < 0 ? 'jump' : 'fall';
    else if (p.shield) clip = 'shield';
    else if (moving) clip = 'run';
    skel.play(clip);
    if (p.animEvent !== v.lastAnimEvent) {
      v.lastAnimEvent = p.animEvent;
      if (item?.id === 'sword') skel.playOverlay('slash');
      else if (item?.id === 'bomb') skel.playOverlay('throw');
      else if (item?.id === 'pickaxe' || item?.kind === 'block') skel.playOverlay('dig');
    }
    // 조준 (활 / 폭탄): 앞팔이 커서를 향함
    if (item?.id === 'bow' || (item?.id === 'bomb' && (p.attackTimer > 0 || p.charge > 0))) {
      let ang = Math.atan2(p.aimY, p.aimX);
      if (item.id === 'bow' && cls.bow) {
        // 팔은 시뮬의 발사 원점(활 손)을 향한다: 어깨 → (몸 중앙 + handY + 조준 방향*handReach). 활이 가슴 높이로 내려온다.
        const len = Math.hypot(p.aimX, p.aimY) || 1;
        const dx = (p.aimX || p.facing) / len, dy = p.aimY / len;
        const reach = cls.bow.handReach ?? 0;
        const shoulderUp = SHOULDER_ABOVE_CENTER;
        ang = Math.atan2(shoulderUp + (cls.bow.handY ?? 0) + dy * reach, dx * reach || dx);
      }
      skel.setAim(['armF', 'forearmF'], ang);
    } else skel.setAim(null);
    skel.setTint(p.hurtTimer > 0 ? 0xff8080 : null);
    skel.update(dtTicks);
    // 로컬 플레이어 커서 타일 표시 (시뮬과 동일한 규칙으로 계산)
    const pv = isLocal ? world.previewTarget(p) : null;
    if (pv) {
      this.cursor.clear().rect(pv.tx * TILE_PX + 0.5, pv.ty * TILE_PX + 0.5, TILE_PX - 1, TILE_PX - 1).stroke({ color: pv.ok ? 0xffffff : 0xff4040, width: 0.5, alpha: 0.9 });
      this.cursor.visible = true;
      // 설치 미리보기 그림자
      if (item?.kind === 'block' && item.tile) {
        const t = this.tex.tile(TILE_TABLE[tileId(item.tile)].texture ?? '', 0);
        if (t) { this.ghost.texture = t; this.ghost.position.set(pv.tx * TILE_PX, pv.ty * TILE_PX); this.ghost.tint = pv.ok ? 0xffffff : 0xff6060; this.ghost.visible = true; }
      } else this.ghost.visible = false;
    } else if (isLocal) { this.cursor.visible = false; this.ghost.visible = false; }
  }

  // ---------- 이벤트/파티클 ----------
  private spawnParticles(x: number, y: number, n: number, color: number, speed: number, life: number): void {
    for (let i = 0; i < n; i++) {
      const sp = new Sprite(this.tex.part('particle'));
      sp.tint = color;
      sp.anchor.set(0.5);
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.fxLayer.addChild(sp);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life: life * (0.5 + Math.random() * 0.5), sp });
    }
  }
  private handleEvents(events: WorldEvent[]): void {
    for (const e of events) {
      if (this.eventSink) this.eventSink(e);
      const x = e.x / FP_ONE, y = e.y / FP_ONE;
      switch (e.kind) {
        case 'hit': this.spawnParticles(x + 3, y + 7, e.team === -1 ? 4 : 8, e.team === -1 ? 0xffffff : 0xd02020, 1.5, 12); if (e.team !== -1 && e.tile) this.floatText(x + 3, y - 2, `-${e.tile}`, 0xff5050); break;
        case 'die': this.spawnParticles(x + 3, y + 7, 20, 0xb01010, 2.5, 30); this.addShake(x, y, 2); break;
        case 'explode': this.spawnParticles(x, y, 40, 0xffa020, 4, 25); this.spawnParticles(x, y, 20, 0x404040, 2, 40); this.addShake(x, y, 6); break;
        case 'dig': { const def = e.tile !== undefined ? TILE_TABLE[e.tile] : undefined; this.spawnParticles(x, y, 5, def?.name === 'stone' || def?.name === 'gold_ore' ? 0x909090 : 0x7a5230, 1.2, 15); break; }
        case 'build': this.spawnParticles(x, y, 4, 0xffffff, 0.8, 10); break;
        case 'mount': this.spawnParticles(x + 3, y + 7, 6, 0xffffff, 1, 10); break;
        case 'vhit': this.spawnParticles(x, y, 6, 0xc0a060, 1.5, 12); if (e.tile) this.floatText(x, y - 6, `-${e.tile}`, 0xffc040); break;
        case 'loot': this.spawnParticles(x, y, 6, DROP_COLORS[e.tile ?? 0] ?? 0xa8763e, 1, 12); if (e.by) this.floatText(x, y - 3, `+${e.by}${DROP_ICONS[e.tile ?? 0] ?? ''}`, DROP_COLORS[e.tile ?? 0] ?? 0xffffff); break;
        case 'capture': this.spawnParticles(x + 3, y, 30, e.team === 0 ? 0x4a7bff : 0xff4a4a, 3, 40); break;
        default: break;
      }
    }
  }
  /** 떠오르는 숫자/텍스트 (데미지 등) */
  private floatText(x: number, y: number, text: string, color: number): void {
    const t = new Text({ text, style: { fontFamily: 'monospace', fontSize: 5, fill: color, stroke: { color: 0x000000, width: 1 }, fontWeight: 'bold' }, resolution: 4 });
    t.anchor.set(0.5, 1);
    t.position.set(x, y);
    this.fxLayer.addChild(t);
    this.floaters.push({ t, vy: -0.35, life: 24 });
  }

  private updateParticles(dtTicks: number): void {
    for (let i = 0; i < this.floaters.length; i++) {
      const f = this.floaters[i];
      f.life -= dtTicks;
      if (f.life <= 0) { f.t.destroy(); this.floaters.splice(i, 1); i--; continue; }
      f.t.position.y += f.vy * dtTicks;
      f.t.alpha = Math.min(1, f.life / 8);
    }
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dtTicks;
      if (p.life <= 0) { p.sp.destroy(); this.particles.splice(i, 1); i--; continue; }
      p.vy += 0.15 * dtTicks;
      p.x += p.vx * dtTicks; p.y += p.vy * dtTicks;
      p.sp.position.set(p.x, p.y);
      p.sp.alpha = Math.min(1, p.life / 8);
    }
  }

  // ---------- 메인 ----------
  update(world: World, alpha: number, dtTicks: number, localPid: number, screenW: number, screenH: number): void {
    this.flushDirty(world);
    // 틱 전진 시 보간용 위치 갱신
    if (world.tick !== this.lastTick) {
      const jumped = world.tick - this.lastTick !== 1;
      for (const p of world.players) {
        const v = this.getPlayerView(p);
        if (jumped) { v.prevX = p.x; v.prevY = p.y; } else { v.prevX = v.curX; v.prevY = v.curY; }
        v.curX = p.x; v.curY = p.y;
        // 리스폰/텔레포트: 거리가 크면 스냅
        if (Math.abs(v.curX - v.prevX) > 20 * FP_ONE || Math.abs(v.curY - v.prevY) > 20 * FP_ONE) { v.prevX = v.curX; v.prevY = v.curY; }
      }
      for (const veh of world.vehicles) {
        const v = this.getVehicleView(veh);
        if (jumped) { v.prevX = veh.x; v.prevY = veh.y; v.prevAng = veh.angle; } else { v.prevX = v.curX; v.prevY = v.curY; v.prevAng = v.curAng; }
        v.curX = veh.x; v.curY = veh.y; v.curAng = veh.angle;
        if (Math.abs(v.curX - v.prevX) > 20 * FP_ONE || Math.abs(v.curY - v.prevY) > 20 * FP_ONE) { v.prevX = v.curX; v.prevY = v.curY; }
      }
      this.handleEvents(world.events);
      this.lastTick = world.tick;
    }
    // 사라진 플레이어 뷰 정리
    for (const [pid, v] of this.players) if (!world.getPlayer(pid)) { v.skel.root.destroy(); v.name.destroy(); v.hp.destroy(); this.players.delete(pid); }
    for (const p of world.players) this.updatePlayer(world, p, this.getPlayerView(p), alpha, dtTicks, p.id === localPid);

    // 탈것
    const seenVeh = new Set<number>();
    for (const veh of world.vehicles) {
      seenVeh.add(veh.id);
      const v = this.getVehicleView(veh);
      const def = VEHICLES[veh.kind];
      const x = (v.prevX + (v.curX - v.prevX) * alpha) / FP_ONE + def.width / 2;
      const y = (v.prevY + (v.curY - v.prevY) * alpha) / FP_ONE + def.height / 2;
      let da = v.curAng - v.prevAng; if (da > 2048) da -= 4096; else if (da < -2048) da += 4096;
      const ang = (v.prevAng + da * alpha) * (Math.PI * 2 / 4096);
      v.root.position.set(x, y);
      v.root.rotation = ang;
      v.body.scale.x = veh.facing;
      const spin = veh.odo / FP_ONE / def.wheelRadius;
      for (const wsp of v.wheels) wsp.rotation = spin;
      v.hp.clear();
      if (veh.hp < def.hp) { v.hp.rect(-8, -def.height / 2 - 4, 16, 1.5).fill({ color: 0x000000, alpha: 0.6 }); v.hp.rect(-8, -def.height / 2 - 4, 16 * veh.hp / def.hp, 1.5).fill({ color: veh.team === 0 ? 0x4a7bff : 0xff4a4a }); }
    }
    for (const [id, v] of this.vehicleViews) if (!seenVeh.has(id)) { v.root.destroy({ children: true }); this.vehicleViews.delete(id); }

    // 투사체
    const seen = new Set<number>();
    for (const pr of world.projectiles) {
      seen.add(pr.id);
      let sp = this.projSprites.get(pr.id);
      if (!sp) {
        sp = new Sprite(this.tex.part(pr.kind === ProjKind.Arrow ? 'arrow' : 'bomb'));
        sp.anchor.set(pr.kind === ProjKind.Arrow ? 0.8 : 0.5, 0.5);
        this.entityLayer.addChild(sp);
        this.projSprites.set(pr.id, sp);
      }
      sp.position.set(pr.x / FP_ONE, pr.y / FP_ONE);
      if (pr.kind === ProjKind.Arrow) { if (!pr.stuck) sp.rotation = Math.atan2(pr.vy, pr.vx); }
      else sp.rotation += 0.2 * dtTicks * Math.sign(pr.vx || 1);
      if (pr.kind === ProjKind.Bomb && pr.timer < 30 && (pr.timer & 4)) sp.tint = 0xff4040; else sp.tint = 0xffffff;
    }
    for (const [id, sp] of this.projSprites) if (!seen.has(id)) { sp.destroy(); this.projSprites.delete(id); }

    // 드롭 자원
    const seenDrops = new Set<number>();
    for (const d of world.drops) {
      seenDrops.add(d.id);
      let sp = this.dropSprites.get(d.id);
      if (!sp) {
        sp = new Sprite(this.tex.part(DROP_PARTS[d.kind] ?? 'drop_wood'));
        sp.anchor.set(0.5, 0.5);
        sp.zIndex = 6;
        this.entityLayer.addChild(sp);
        this.dropSprites.set(d.id, sp);
      }
      sp.position.set(d.x / FP_ONE, d.y / FP_ONE);
      sp.alpha = d.life < 150 ? (d.life & 8 ? 1 : 0.3) : 1;
    }
    for (const [id, sp] of this.dropSprites) if (!seenDrops.has(id)) { sp.destroy(); this.dropSprites.delete(id); }

    // 깃발
    while (this.flagSprites.length < world.flags.length) {
      const sp = new Sprite(this.tex.part('flag'));
      sp.anchor.set(0, 1);
      this.entityLayer.addChild(sp);
      sp.zIndex = 5;
      this.flagSprites.push(sp);
    }
    world.flags.forEach((f, i) => {
      const sp = this.flagSprites[i];
      sp.tint = TEAM_COLORS[f.team];
      sp.position.set(f.x / FP_ONE - 1, f.y / FP_ONE + (f.carrier ? 2 : 4));
    });

    this.updateParticles(dtTicks);
    this.drawWater(world, screenW, screenH);

    // 카메라
    const local = world.getPlayer(localPid);
    if (local) {
      const v = this.players.get(local.id);
      if (v) {
        const tx = (v.prevX + (v.curX - v.prevX) * alpha) / FP_ONE + CLASSES[local.cls].width / 2;
        const ty = (v.prevY + (v.curY - v.prevY) * alpha) / FP_ONE + CLASSES[local.cls].height / 2;
        const k = 1 - Math.pow(0.001, dtTicks / 30);
        this.camX += (tx - this.camX) * k;
        this.camY += (ty - this.camY) * k;
      }
    } else if (this.camX === 0 && this.camY === 0) { this.camX = (world.map.w * TILE_PX) / 2; this.camY = (world.map.h * TILE_PX) / 3; }
    const viewW = screenW / this.zoom, viewH = screenH / this.zoom;
    const mapW = world.map.w * TILE_PX, mapH = world.map.h * TILE_PX;
    this.camX = Math.max(viewW / 2, Math.min(mapW - viewW / 2, this.camX));
    this.camY = Math.max(viewH / 2 - 40, Math.min(mapH - viewH / 2, this.camY));
    this.worldLayer.scale.set(this.zoom);
    let sx = 0, sy = 0;
    if (this.shake > 0.2) {
      this.shakeSeed = (this.shakeSeed * 1103515245 + 12345) & 0x7fffffff;
      sx = ((this.shakeSeed & 0xff) / 128 - 1) * this.shake;
      sy = (((this.shakeSeed >> 8) & 0xff) / 128 - 1) * this.shake;
      this.shake *= Math.pow(0.85, dtTicks);
    } else this.shake = 0;
    this.worldLayer.position.set(Math.round(screenW / 2 - (this.camX + sx) * this.zoom), Math.round(screenH / 2 - (this.camY + sy) * this.zoom));
  }

  /** 화면 흔들림: 거리(픽셀)에 따라 감쇠 */
  private addShake(x: number, y: number, strength: number): void {
    const d = Math.hypot(x - this.camX, y - this.camY);
    const s = strength * Math.max(0, 1 - d / 160);
    if (s > this.shake) this.shake = s;
  }

  /** 보이는 영역의 물만 매 프레임 그린다 (수위에 비례한 높이의 반투명 사각형) */
  private drawWater(world: World, screenW: number, screenH: number): void {
    const g = this.waterGfx;
    g.clear();
    const map = world.map;
    const viewW = screenW / this.zoom, viewH = screenH / this.zoom;
    const x0 = Math.max(0, Math.floor((this.camX - viewW / 2) / TILE_PX) - 1), x1 = Math.min(map.w - 1, Math.ceil((this.camX + viewW / 2) / TILE_PX) + 1);
    const y0 = Math.max(0, Math.floor((this.camY - viewH / 2) / TILE_PX) - 1), y1 = Math.min(map.h - 1, Math.ceil((this.camY + viewH / 2) / TILE_PX) + 1);
    let any = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const lv = map.water[y * map.w + x];
        if (lv === 0) continue;
        // 위 칸에도 물이 있으면 가득 찬 것으로 그려 이음새를 없앰
        const full = lv >= WATER_MAX || map.water[(y - 1) * map.w + x] > 0;
        const hgt = full ? TILE_PX : (TILE_PX * lv) / WATER_MAX;
        g.rect(x * TILE_PX, y * TILE_PX + TILE_PX - hgt, TILE_PX, hgt);
        any = true;
      }
    }
    if (any) g.fill({ color: 0x3a80ff, alpha: 0.55 });
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.worldLayer.position.x) / this.zoom, (sy - this.worldLayer.position.y) / this.zoom];
  }
}

