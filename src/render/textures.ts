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
}
