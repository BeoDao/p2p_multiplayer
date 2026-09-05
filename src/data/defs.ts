/**
 * JSON 데이터 → 타입 정의 및 조회 테이블.
 * 시뮬레이션은 이 모듈을 통해서만 게임 수치를 읽는다. (데이터 교체 지점)
 */
import tilesJson from './tiles.json';
import classesJson from './classes.json';
import itemsJson from './items.json';
import vehiclesJson from './vehicles.json';

export type ResourceKind = 'wood' | 'stone' | 'gold';
export const RESOURCE_KINDS: ResourceKind[] = ['wood', 'stone', 'gold'];

export interface TileDef {
  id: number;
  name: string;
  solid: boolean;
  hp: number;
  texture: string | null;
  yields?: Partial<Record<ResourceKind, number>>;
  buildable?: boolean;
  ladder?: boolean;
  door?: boolean;
  layer?: 'front' | 'back';
  natural?: boolean;
  tree?: boolean;
  drop?: boolean;
  shop?: boolean;
  damage?: number;
}

export interface ClassDef {
  id: number;
  name: string;
  label: string;
  labels?: Record<string, string>;
  hp: number;
  runSpeed: number;
  jumpSpeed: number;
  width: number;
  height: number;
  skin: string;
  weapon: string;
  hotbar: string[];
  attack?: { damage: number; cooldown: number; windup: number; range: number; knockback: number };
  shield?: boolean;
  bombs?: number;
  bombFuse?: number;
  bombRadius?: number;
  bombDamage?: number;
  bombTileDamage?: number;
  bow?: {
    chargeTicks: number; minSpeed: number; maxSpeed: number;
    damageMin: number; damageMax: number; arrows: number; arrowGravity: number;
    /** 발사 원점(활을 든 손): 몸 중앙에서 위로 handY px, 조준 방향으로 handReach px. 렌더러의 팔 조준도 같은 점을 향한다 */
    handY?: number; handReach?: number;
  };
  dig?: { damage: number; cooldown: number; reach: number };
  shop?: { buy: 'bombs' | 'arrows'; amount: number; max: number; cost: Partial<Record<ResourceKind, number>> };
  build?: { reach: number; cooldown: number };
}

export interface ItemDef {
  id: string;
  label: string;
  labels?: Record<string, string>;
  kind: 'weapon' | 'block';
  part?: string;
  icon: string;
  tile?: string;
  cost?: Partial<Record<ResourceKind, number>>;
  rot?: number;
  ox?: number;
  oy?: number;
}

export const TILES: TileDef[] = (tilesJson as { tiles: TileDef[] }).tiles;
export const TILE_BY_NAME = new Map<string, TileDef>(TILES.map((t) => [t.name, t]));
export const TILE_TABLE: TileDef[] = [];
for (const t of TILES) TILE_TABLE[t.id] = t;
export const tileId = (name: string): number => {
  const t = TILE_BY_NAME.get(name);
  if (!t) throw new Error('unknown tile ' + name);
  return t.id;
};

export const T_AIR = tileId('air');
export const T_DIRT = tileId('dirt');
export const T_GRASS = tileId('grass');
export const T_STONE = tileId('stone');
export const T_GOLD = tileId('gold_ore');
export const T_BEDROCK = tileId('bedrock');
export const T_TRUNK = tileId('tree_trunk');
export const T_LEAF = tileId('tree_leaf');
export const T_LADDER = tileId('ladder');
export const T_DIRT_BACK = tileId('dirt_back');

export const CLASSES: ClassDef[] = (classesJson as { classes: ClassDef[] }).classes;

export interface VehicleDef {
  id: number;
  name: string;
  label: string;
  labels?: Record<string, string>;
  width: number; height: number; wheelBase: number; wheelRadius: number;
  seatX: number; seatY: number;
  hp: number; accel: number; maxSpeed: number; friction: number;
  ramDamage: number; ramSpeed: number; ramKnockback: number;
  respawnTicks: number;
  spawnOffset: number;
}
export const VEHICLES: VehicleDef[] = (vehiclesJson as { vehicles: VehicleDef[] }).vehicles;
export const CLASS_BY_NAME = new Map<string, ClassDef>(CLASSES.map((c) => [c.name, c]));

export const ITEMS: ItemDef[] = (itemsJson as { items: ItemDef[] }).items;
export const ITEM_BY_ID = new Map<string, ItemDef>(ITEMS.map((i) => [i.id, i]));
export const ITEM_INDEX = new Map<string, number>(ITEMS.map((i, idx) => [i.id, idx]));

/** 클래스별 핫바 슬롯 → 아이템 정의 */
export function hotbarItem(cls: ClassDef, slot: number): ItemDef | undefined {
  const id = cls.hotbar[slot];
  return id ? ITEM_BY_ID.get(id) : undefined;
}
