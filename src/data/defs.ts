/**
 * JSON 데이터 → 타입 정의 및 조회 테이블.
 * 시뮬레이션은 이 모듈을 통해서만 게임 수치를 읽는다. (데이터 교체 지점)
 */
import tilesJson from './tiles.json';
import classesJson from './classes.json';
import itemsJson from './items.json';
import vehiclesJson from './vehicles.json';

export type ResourceKind = 'wood' | 'stone' | 'iron';
export const RESOURCE_KINDS: ResourceKind[] = ['wood', 'stone', 'iron'];

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
  bulletproof?: boolean; // 총알 피해 없음
  wire?: boolean; // 철조망: 안에 있으면 감속 + 주기 피해
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
  shieldPush?: number; // 돌파: 방패로 밀칠 때 넉백 (FP)
  gun?: {
    rof: number; speed: number; damage: number; gravity: number; life: number;
    spreadMin: number; spreadMax: number; spreadPerShot: number; spreadDecay: number; crouchDiv: number;
    magazine: number; reloadTicks: number; ammo: number; ammoMax: number; tileDamage: number;
    handY?: number; handReach?: number;
    auto?: boolean; // false 면 누를 때마다 1발 (볼트액션)
    scope?: { steadyTicks: number; speedDiv: number }; // 우클릭 조준: steadyTicks 동안 퍼짐이 0 으로 수렴, 이동 속도 /speedDiv
  };
  /** 정찰 드론: 소유자 커서를 따라 나는 정찰기. radius 안 적을 spotTicks 동안 표시 */
  drone?: { count: number; speed: number; life: number; radius: number; spotTicks: number; hp: number };
  /** 클레이모어: 붙여 두면 trigger px 안에 적이 오면 터짐 */
  mine?: { count: number; max: number; speed: number; radius: number; damage: number; tileDamage: number; trigger: number };
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
  /** C4: 시작 개수/최대 보유/동시 설치 상한/투척 속도(FP)/폭발 반경(px)/피해/타일 피해/자동 폭발 틱 */
  c4?: { count: number; max: number; live: number; speed: number; radius: number; damage: number; tileDamage: number; life: number };
  shop?: { buy: 'bombs' | 'arrows' | 'ammo' | 'c4'; amount: number; max: number; cost: Partial<Record<ResourceKind, number>> };
  build?: { reach: number; cooldown: number };
}

export interface ItemDef {
  id: string;
  label: string;
  labels?: Record<string, string>;
  kind: 'weapon' | 'block' | 'vehicle';
  part?: string;
  icon: string;
  tile?: string;
  vehicle?: string; // kind 'vehicle': 설치할 탈것 이름 (vehicles.json)
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
export const T_IRON = tileId('iron_ore');
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
  gunnerX?: number; gunnerY?: number; // 포수 자리 (있으면 2인승)
  armor?: boolean; // 총알/화살 면역
  mg?: { rof: number; speed: number; damage: number; spread: number; muzzle: number }; // 포수 기관총
  cannon?: { rof: number; speed: number; damage: number; radius: number; tileDamage: number; gravity: number; life: number; muzzle: number; turretY: number }; // 주포 (운전자 좌클릭)
  maxPerTeam?: number; // 건설형 팀당 상한
  hp: number; accel: number; maxSpeed: number; friction: number;
  ramDamage: number; ramSpeed: number; ramKnockback: number;
  respawnTicks: number; // 0 = 재생성 없음 (건설형)
  spawnOffset: number;
  mountable?: boolean; // false 면 탈 수 없음
  body?: string; // 렌더 파츠
  scrap?: Partial<Record<ResourceKind, number>>; // 파괴 시 고철 드롭
  /** 자동 포탑: 적이 range px 안에 시선이 닿으면 aimTicks 조준 후 rof 틱마다 발사 */
  turret?: { rof: number; range: number; damage: number; speed: number; spread: number; aimTicks: number; maxPerTeam: number };
}
export const VEHICLES: VehicleDef[] = (vehiclesJson as { vehicles: VehicleDef[] }).vehicles;
export const VEHICLE_BY_NAME = new Map<string, VehicleDef>(VEHICLES.map((v) => [v.name, v]));
export const CLASS_BY_NAME = new Map<string, ClassDef>(CLASSES.map((c) => [c.name, c]));

export const ITEMS: ItemDef[] = (itemsJson as { items: ItemDef[] }).items;
export const ITEM_BY_ID = new Map<string, ItemDef>(ITEMS.map((i) => [i.id, i]));
export const ITEM_INDEX = new Map<string, number>(ITEMS.map((i, idx) => [i.id, idx]));

/** 클래스별 핫바 슬롯 → 아이템 정의 */
export function hotbarItem(cls: ClassDef, slot: number): ItemDef | undefined {
  const id = cls.hotbar[slot];
  return id ? ITEM_BY_ID.get(id) : undefined;
}
