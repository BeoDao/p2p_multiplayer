/**
 * 기본 프로시저럴 파츠/타일 텍스처. 외부 PNG 로 교체 가능 (TextureRegistry 참고).
 * 모든 그림은 1px = 월드 1px 인 작은 캔버스에 그려지고 nearest 스케일링으로 확대된다.
 */
import { Texture } from 'pixi.js';

export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function makeCanvas(w: number, h: number, paint: Painter): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  paint(ctx, w, h);
  return c;
}

export function canvasTexture(w: number, h: number, paint: Painter): Texture {
  const t = Texture.from(makeCanvas(w, h, paint));
  t.source.scaleMode = 'nearest';
  return t;
}

const px = (ctx: CanvasRenderingContext2D, x: number, y: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); };
const rect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

/** 간단한 해시 잡음 (렌더 전용, 결정론 불필요하지만 재현 가능) */
const noise = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------- 캐릭터 파츠 (흰색/회색 계열 → 팀색 tint 대상) ----------
export const PART_PAINTERS: Record<string, { w: number; h: number; paint: Painter }> = {
  thigh: { w: 3, h: 5, paint: (c) => { rect(c, 0, 0, 3, 5, '#e8e8e8'); rect(c, 0, 0, 1, 5, '#b8b8b8'); } },
  shin: { w: 3, h: 5, paint: (c) => { rect(c, 0, 0, 3, 4, '#5a4634'); rect(c, 0, 3, 3, 2, '#2f2419'); } },
  arm: { w: 3, h: 4, paint: (c) => { rect(c, 0, 0, 3, 4, '#e0e0e0'); rect(c, 0, 0, 1, 4, '#b0b0b0'); } },
  forearm: { w: 2, h: 4, paint: (c) => { rect(c, 0, 0, 2, 3, '#d9b48f'); rect(c, 0, 3, 2, 1, '#c99a70'); } },
  torso: { w: 5, h: 6, paint: (c) => { rect(c, 0, 0, 5, 6, '#f0f0f0'); rect(c, 0, 0, 1, 6, '#c0c0c0'); rect(c, 2, 1, 1, 4, '#d0d0d0'); } },
  head_knight: { w: 6, h: 6, paint: (c) => {
    rect(c, 0, 0, 6, 6, '#8d8d97'); rect(c, 1, 0, 4, 1, '#b5b5c0'); rect(c, 4, 2, 2, 1, '#1a1a22'); rect(c, 1, 5, 4, 1, '#5a5a66');
    px(c, 0, 0, 'rgba(0,0,0,0)'); px(c, 5, 0, 'rgba(0,0,0,0)');
  } },
  head_rifleman: { w: 6, h: 6, paint: (c) => {
    rect(c, 0, 0, 6, 4, '#4f5a3c'); rect(c, 1, 0, 4, 1, '#66744d'); rect(c, 1, 3, 5, 3, '#e6c39c'); rect(c, 4, 3, 1, 1, '#222'); rect(c, 0, 3, 6, 1, '#3d4630');
    px(c, 0, 0, 'rgba(0,0,0,0)'); px(c, 5, 0, 'rgba(0,0,0,0)');
  } },
  backpack: { w: 3, h: 5, paint: (c) => { rect(c, 0, 0, 3, 5, '#5a6644'); rect(c, 0, 1, 3, 1, '#3d4630'); rect(c, 1, 3, 1, 1, '#8a8a70'); } },
  head_archer: { w: 6, h: 6, paint: (c) => {
    rect(c, 0, 0, 6, 6, '#3f7a3a'); rect(c, 2, 2, 4, 3, '#e6c39c'); rect(c, 4, 3, 1, 1, '#222'); rect(c, 0, 0, 6, 1, '#2e5c2b'); px(c, 0, 0, 'rgba(0,0,0,0)');
  } },
  head_builder: { w: 6, h: 6, paint: (c) => {
    rect(c, 1, 1, 5, 5, '#e6c39c'); rect(c, 0, 0, 6, 2, '#7a5230'); rect(c, 4, 3, 1, 1, '#222'); rect(c, 5, 1, 1, 1, '#7a5230');
  } },
  shield_back: { w: 4, h: 5, paint: (c) => { rect(c, 0, 0, 4, 5, '#6a6a75'); rect(c, 1, 1, 2, 3, '#9a9aa5'); } },
  quiver: { w: 2, h: 6, paint: (c) => { rect(c, 0, 1, 2, 5, '#6b4a2b'); px(c, 0, 0, '#d9d9d9'); px(c, 1, 0, '#d9d9d9'); } },
  none: { w: 1, h: 1, paint: () => {} },
  weapon_sword: { w: 9, h: 3, paint: (c) => { rect(c, 0, 1, 2, 1, '#6b4a2b'); rect(c, 2, 0, 1, 3, '#c9a227'); rect(c, 3, 1, 6, 1, '#dfe4ea'); px(c, 8, 1, '#ffffff'); } },
  weapon_bomb: { w: 4, h: 4, paint: (c) => { rect(c, 0, 1, 3, 3, '#222'); px(c, 1, 1, '#444'); px(c, 3, 0, '#ffb000'); } },
  weapon_rifle: { w: 11, h: 3, paint: (c) => { rect(c, 0, 1, 3, 2, '#5a3a1b'); rect(c, 2, 0, 7, 2, '#2a2a30'); rect(c, 9, 0, 2, 1, '#44444c'); rect(c, 4, 2, 2, 1, '#2a2a30'); px(c, 6, 1, '#555560'); } },
  weapon_grenade: { w: 3, h: 4, paint: (c) => { rect(c, 0, 1, 3, 3, '#4f5a3c'); rect(c, 1, 0, 1, 1, '#8a8a90'); px(c, 1, 2, '#3d4630'); } },
  bullet: { w: 3, h: 1, paint: (c) => { rect(c, 0, 0, 2, 1, '#ffd27a'); px(c, 2, 0, '#ffffff'); } },
  weapon_bow: { w: 3, h: 9, paint: (c) => { rect(c, 1, 0, 1, 9, '#8a5a2b'); rect(c, 2, 1, 1, 7, '#e8e8e8'); px(c, 0, 0, '#8a5a2b'); px(c, 0, 8, '#8a5a2b'); } },
  weapon_pickaxe: { w: 7, h: 4, paint: (c) => { rect(c, 0, 1, 5, 1, '#6b4a2b'); rect(c, 4, 0, 3, 1, '#9a9aa5'); rect(c, 6, 1, 1, 2, '#9a9aa5'); px(c, 5, 1, '#7a7a85'); } },
  arrow: { w: 6, h: 1, paint: (c) => { rect(c, 0, 0, 5, 1, '#8a5a2b'); px(c, 5, 0, '#dfe4ea'); } },
  bomb: { w: 4, h: 4, paint: (c) => { rect(c, 0, 1, 3, 3, '#222'); px(c, 1, 1, '#444'); px(c, 3, 0, '#ffb000'); } },
  flag: { w: 6, h: 10, paint: (c) => { rect(c, 0, 0, 1, 10, '#6b4a2b'); rect(c, 1, 0, 5, 4, '#ffffff'); } },
  cart_body: { w: 24, h: 8, paint: (c) => { rect(c, 1, 2, 22, 5, '#8a5a2b'); rect(c, 0, 1, 24, 1, '#a8763e'); rect(c, 2, 3, 20, 1, '#6b4a2b'); rect(c, 20, 0, 3, 2, '#5a3a1b'); rect(c, 1, 0, 3, 2, '#5a3a1b'); px(c, 4, 4, '#c8a060'); px(c, 19, 4, '#c8a060'); } },
  wheel: { w: 8, h: 8, paint: (c) => { rect(c, 1, 0, 6, 8, '#3a3a40'); rect(c, 0, 1, 8, 6, '#3a3a40'); rect(c, 2, 2, 4, 4, '#8a5a2b'); rect(c, 3, 0, 2, 8, '#6b4a2b'); rect(c, 0, 3, 8, 2, '#6b4a2b'); px(c, 3, 3, '#ffd76a'); px(c, 4, 4, '#ffd76a'); } },
  particle: { w: 1, h: 1, paint: (c) => rect(c, 0, 0, 1, 1, '#ffffff') },
  edge_h: { w: 8, h: 1, paint: (c) => rect(c, 0, 0, 8, 1, '#ffffff') },
  edge_v: { w: 1, h: 8, paint: (c) => rect(c, 0, 0, 1, 8, '#ffffff') },
  edge_px: { w: 1, h: 1, paint: (c) => rect(c, 0, 0, 1, 1, '#ffffff') },
  drop_wood: { w: 5, h: 4, paint: (c) => { rect(c, 0, 0, 5, 4, '#8a5a2b'); rect(c, 0, 1, 5, 1, '#a8763e'); px(c, 4, 0, '#6b4a2b'); } },
  drop_stone: { w: 5, h: 4, paint: (c) => { rect(c, 0, 1, 5, 3, '#8d8d95'); rect(c, 1, 0, 3, 1, '#9a9aa5'); px(c, 1, 2, '#6d6d75'); } },
  drop_bomb: { w: 4, h: 4, paint: (c) => { rect(c, 0, 1, 3, 3, '#222'); px(c, 1, 1, '#444'); px(c, 3, 0, '#ffb000'); } },
  drop_arrow: { w: 6, h: 3, paint: (c) => { rect(c, 0, 0, 5, 1, '#8a5a2b'); px(c, 5, 0, '#dfe4ea'); rect(c, 0, 2, 5, 1, '#8a5a2b'); px(c, 5, 2, '#dfe4ea'); } },
  drop_gold: { w: 5, h: 4, paint: (c) => { rect(c, 0, 1, 5, 3, '#e0b020'); rect(c, 1, 0, 3, 1, '#fff0a0'); px(c, 3, 2, '#b08010'); } },
  heart: { w: 5, h: 5, paint: (c) => { rect(c, 0, 1, 2, 2, '#e33'); rect(c, 3, 1, 2, 2, '#e33'); rect(c, 1, 2, 3, 2, '#e33'); px(c, 2, 4, '#e33'); px(c, 0, 0, '#e33'); px(c, 1, 0, '#e33'); px(c, 3, 0, '#e33'); px(c, 4, 0, '#e33'); } },
};

// ---------- 타일 ----------
const TILE_COLORS: Record<string, [string, string, string]> = {
  dirt: ['#7a5230', '#6a4628', '#8a6038'],
  grass: ['#7a5230', '#4c9a3c', '#3c8030'],
  stone: ['#7d7d85', '#6d6d75', '#8d8d95'],
  gold_ore: ['#7d7d85', '#e0b020', '#6d6d75'],
  bedrock: ['#3a3a40', '#303036', '#44444a'],
  tree_trunk: ['#5a3a1e', '#4a2e16', '#6a4626'],
  tree_leaf: ['#3f8a37', '#357a2f', '#4a9a40'],
  wood_block: ['#a8763e', '#8f6232', '#b8864e'],
  stone_block: ['#9a9aa5', '#7a7a85', '#aaaab5'],
  ladder: ['#a8763e', '#8f6232', 'rgba(0,0,0,0)'],
  wood_door: ['#8f6232', '#6f4a22', '#a8763e'],
  stone_door: ['#8a8a95', '#6a6a75', '#9a9aa5'],
  spikes: ['rgba(0,0,0,0)', '#c8c8d0', '#909098'],
  wood_back: ['#5a4020', '#503818', '#644828'],
  stone_back: ['#4a4a52', '#42424a', '#52525a'],
  dirt_back: ['#4e3520', '#452e1b', '#583c26'],
  workshop: ['#8a6a3a', '#e0c060', '#5a4020'],
};

export function paintTile(name: string, ctx: CanvasRenderingContext2D, ox = 0, oy = 0, seed = 0): void {
  const col = TILE_COLORS[name];
  if (!col) return;
  const [base, a, b] = col;
  ctx.fillStyle = base;
  ctx.fillRect(ox, oy, 8, 8);
  switch (name) {
    case 'grass':
      rect(ctx, ox, oy, 8, 2, a); for (let x = 0; x < 8; x++) if (noise(x, 1, seed) > 0.5) px(ctx, ox + x, oy + 2, b);
      for (let x = 0; x < 8; x++) if (noise(x, 3, seed) > 0.6) px(ctx, ox + x, oy + 1, b);
      break;
    case 'gold_ore':
      for (let i = 0; i < 3; i++) { const gx = ox + ((noise(i, 0, seed) * 6) | 0), gy = oy + ((noise(i, 1, seed) * 6) | 0); rect(ctx, gx, gy, 2, 2, a); px(ctx, gx, gy, '#fff0a0'); }
      for (let i = 0; i < 3; i++) px(ctx, ox + ((noise(i, 2, seed) * 8) | 0), oy + ((noise(i, 3, seed) * 8) | 0), b);
      break;
    case 'ladder':
      ctx.clearRect(ox, oy, 8, 8);
      rect(ctx, ox + 1, oy, 1, 8, base); rect(ctx, ox + 6, oy, 1, 8, base); rect(ctx, ox + 1, oy + 1, 6, 1, a); rect(ctx, ox + 1, oy + 5, 6, 1, a);
      break;
    case 'spikes':
      ctx.clearRect(ox, oy, 8, 8);
      for (let i = 0; i < 3; i++) { const x = ox + i * 3; rect(ctx, x, oy + 5, 2, 3, b); px(ctx, x, oy + 4, a); px(ctx, x, oy + 3, a); px(ctx, x, oy + 2, a); }
      break;
    case 'wood_door': case 'stone_door':
      rect(ctx, ox + 1, oy, 6, 8, a); rect(ctx, ox + 2, oy + 1, 4, 6, base); px(ctx, ox + 5, oy + 4, b); rect(ctx, ox, oy + 3, 8, 1, a);
      break;
    case 'wood_block':
      rect(ctx, ox, oy + 3, 8, 1, a); rect(ctx, ox, oy + 7, 8, 1, a); rect(ctx, ox + 3, oy, 1, 3, a); rect(ctx, ox + 6, oy + 4, 1, 3, a);
      break;
    case 'stone_block':
      rect(ctx, ox, oy + 3, 8, 1, a); rect(ctx, ox, oy + 7, 8, 1, a); rect(ctx, ox + 4, oy, 1, 3, a); rect(ctx, ox + 1, oy + 4, 1, 3, a); rect(ctx, ox, oy, 8, 1, b);
      break;
    case 'workshop':
      rect(ctx, ox, oy, 8, 8, b); rect(ctx, ox + 1, oy + 1, 6, 6, base); rect(ctx, ox + 2, oy + 2, 4, 1, a); rect(ctx, ox + 2, oy + 5, 4, 1, a); px(ctx, ox + 3, oy + 3, a); px(ctx, ox + 4, oy + 4, a);
      break;
    case 'tree_trunk':
      rect(ctx, ox + 2, oy, 1, 8, a); rect(ctx, ox + 5, oy, 1, 8, b);
      break;
    default:
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const n = noise(x, y, seed);
        if (n > 0.85) px(ctx, ox + x, oy + y, a); else if (n < 0.12) px(ctx, ox + x, oy + y, b);
      }
  }
}

/** 타일 아틀라스: 이름 → Texture (8x8, 4개 변형) */
export function buildTileTextures(names: string[]): Map<string, Texture[]> {
  const out = new Map<string, Texture[]>();
  for (const n of names) {
    const variants: Texture[] = [];
    for (let v = 0; v < 4; v++) variants.push(canvasTexture(8, 8, (ctx) => paintTile(n, ctx, 0, 0, v)));
    out.set(n, variants);
  }
  return out;
}

/** 아이콘: 타일 이름이면 타일 그림, 아니면 파츠 그림을 16x16 안에 배치 */
export function buildIconDataUrl(key: string): string {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (TILE_COLORS[key]) {
    const tmp = makeCanvas(8, 8, (t) => paintTile(key, t));
    ctx.drawImage(tmp, 0, 0, 16, 16);
  } else {
    const name = key.replace(/^icon_/, 'weapon_');
    const p = PART_PAINTERS[name];
    if (p) {
      const tmp = makeCanvas(p.w, p.h, p.paint);
      const s = Math.floor(Math.min(16 / p.w, 16 / p.h));
      ctx.drawImage(tmp, ((16 - p.w * s) / 2) | 0, ((16 - p.h * s) / 2) | 0, p.w * s, p.h * s);
    }
  }
  return c.toDataURL();
}
