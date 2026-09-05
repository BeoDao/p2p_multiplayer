/**
 * 텍스처 레지스트리. 키 → Texture.
 * 교체 방법: public/assets/parts/manifest.json 에 { "keys": ["head_knight", "weapon_sword", ...] } 를 적고
 * 같은 폴더에 <key>.png 를 두면 프로시저럴 기본 그림 대신 그 PNG 를 사용한다. (코드 수정 불필요)
 * 타일도 동일: public/assets/tiles/manifest.json + <name>.png (8x8, 가로로 변형 N개 이어붙여도 됨).
 */
import { Assets, Texture, Rectangle } from 'pixi.js';
import { PART_PAINTERS, canvasTexture, buildTileTextures } from './partsFactory';
import { TILES } from '../data/defs';

export class TextureRegistry {
  private parts = new Map<string, Texture>();
  private tiles = new Map<string, Texture[]>();

  async load(): Promise<void> {
    // 기본 프로시저럴
    for (const [k, p] of Object.entries(PART_PAINTERS)) this.parts.set(k, canvasTexture(p.w, p.h, p.paint));
    this.tiles = buildTileTextures(TILES.filter((t) => t.texture).map((t) => t.texture!));
    // 오버라이드
    await this.loadOverrides('assets/parts', (k, t) => this.parts.set(k, t));
    await this.loadOverrides('assets/tiles', (k, t) => {
      const n = Math.max(1, Math.floor(t.width / 8));
      const variants: Texture[] = [];
      for (let i = 0; i < n; i++) {
        const sub = new Texture({ source: t.source, frame: new Rectangle(i * 8, 0, 8, Math.min(8, t.height)) });
        variants.push(sub);
      }
      this.tiles.set(k, variants);
    });
  }

  private async loadOverrides(dir: string, put: (k: string, t: Texture) => void): Promise<void> {
    try {
      const res = await fetch(`${dir}/manifest.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      const m = (await res.json()) as { keys?: string[] };
      for (const k of m.keys ?? []) {
        try {
          const t = (await Assets.load(`${dir}/${k}.png`)) as Texture;
          t.source.scaleMode = 'nearest';
          put(k, t);
        } catch (e) { console.warn('texture override failed', k, e); }
      }
    } catch { /* manifest 없음 = 기본 사용 */ }
  }

  part(key: string): Texture {
    return this.parts.get(key) ?? this.parts.get('none') ?? Texture.EMPTY;
  }
  tile(name: string, variant: number): Texture | undefined {
    const v = this.tiles.get(name);
    return v ? v[variant % v.length] : undefined;
  }

  private outlineCache = new Map<string, number>();
  /** 타일 아웃라인 색: 텍스처 평균색을 어둡게 (×0.45). PNG 로 교체해도 자동으로 맞는다 */
  tileOutline(name: string): number {
    let c = this.outlineCache.get(name);
    if (c !== undefined) return c;
    c = darkenedAverage(this.tile(name, 0)) ?? 0x1a1208;
    this.outlineCache.set(name, c);
    return c;
  }
}

function darkenedAverage(tex: Texture | undefined, k = 0.45): number | undefined {
  if (!tex) return undefined;
  try {
    const res = tex.source.resource as CanvasImageSource | undefined;
    if (!res) return undefined;
    const c = document.createElement('canvas');
    const w = tex.frame.width | 0, h = tex.frame.height | 0;
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(res, tex.frame.x, tex.frame.y, w, h, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (!n) return undefined;
    const f = (v: number) => Math.max(0, Math.min(255, Math.round((v / n) * k)));
    return (f(r) << 16) | (f(g) << 8) | f(b);
  } catch { return undefined; }
}
