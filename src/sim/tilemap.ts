/**
 * 타일 지형. 두 레이어:
 *  - front(type/hp/team): 충돌·상호작용하는 앞 타일
 *  - back(backType/backHp): 뒷벽. 자연 지형(흙/돌)을 파면 dirt_back 이 남고, 앞 타일 설치의 지지대가 된다.
 * 파괴/건설은 모두 여기서 처리. 변경된 타일은 dirty 목록에 기록되어 렌더러가 청크를 갱신한다.
 */
import { TILE_TABLE, T_AIR, T_BEDROCK, T_DIRT, T_GRASS, T_STONE, T_GOLD, T_TRUNK, T_LEAF, T_DIRT_BACK, type TileDef } from '../data/defs';
import { Rng } from './rng';

export const NO_TEAM = 255;
export const WATER_MAX = 8;

export class TileMap {
  readonly w: number;
  readonly h: number;
  readonly type: Uint8Array;
  readonly hp: Uint8Array;
  readonly team: Uint8Array;
  readonly backType: Uint8Array;
  readonly backHp: Uint8Array;
  /** 물 수위 0..WATER_MAX (앞 타일이 비어 있는 칸에만 존재) */
  readonly water: Uint8Array;
  private waterTmp: Uint8Array;
  /** 렌더러용 변경 목록 (시뮬 결정론과 무관) */
  dirty: number[] = [];
  /** 이번 틱에 앞/뒤 타일이 사라진 칸 (붕괴 검사용, 월드가 매 틱 비움) */
  removed: number[] = [];

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.type = new Uint8Array(w * h);
    this.hp = new Uint8Array(w * h);
    this.team = new Uint8Array(w * h).fill(NO_TEAM);
    this.backType = new Uint8Array(w * h);
    this.backHp = new Uint8Array(w * h);
    this.water = new Uint8Array(w * h);
    this.waterTmp = new Uint8Array(w * h);
  }

  waterAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.water[y * this.w + x];
  }

  /**
   * 물 시뮬레이션 (셀룰러 오토마타, 정수). 아래로 흐르고 좌우로 평준화된다.
   * 고정된 순회 순서(아래→위, 왼→오)라 결정론적. 앞 타일이 있는 칸에는 물이 들어가지 않는다.
   */
  stepWater(): void {
    const { w, h, water, type } = this;
    const tmp = this.waterTmp;
    tmp.set(water);
    for (let y = h - 2; y >= 0; y--) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        let lv = tmp[i];
        if (lv === 0) continue;
        if (type[i] !== T_AIR && !TILE_TABLE[type[i]].ladder) { tmp[i] = 0; continue; } // 고체/타일 안의 물은 사라짐
        // 아래로
        const bi = i + w;
        if (this.passable(type[bi])) {
          const room = WATER_MAX - tmp[bi];
          if (room > 0) { const f = lv < room ? lv : room; tmp[bi] += f; lv -= f; }
        }
        if (lv === 0) { tmp[i] = 0; continue; }
        // 좌우 평준화 (차이의 1/3 씩, 최소 1)
        if (x > 0 && this.passable(type[i - 1])) {
          const d = lv - tmp[i - 1];
          if (d > 1) { const f = (d + 2) / 3 | 0; tmp[i - 1] += f; lv -= f; }
        }
        if (x < w - 1 && this.passable(type[i + 1])) {
          const d = lv - tmp[i + 1];
          if (d > 1) { const f = (d + 2) / 3 | 0; tmp[i + 1] += f; lv -= f; }
        }
        tmp[i] = lv;
      }
    }
    // 변경된 칸을 dirty 로 (렌더러는 물을 매 프레임 그리므로 표시용 아님) — 여기서는 버퍼 교체만
    water.set(tmp);
  }
  private passable(t: number): boolean {
    return t === T_AIR || !!TILE_TABLE[t].ladder;
  }

  getBack(x: number, y: number): number {
    if (!this.inBounds(x, y)) return T_AIR;
    return this.backType[y * this.w + x];
  }
  setBack(x: number, y: number, t: number): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    this.backType[i] = t;
    this.backHp[i] = TILE_TABLE[t].hp;
    this.dirty.push(i);
  }
  /** 뒷벽에 피해. 파괴되면 true. */
  damageBack(x: number, y: number, amount: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.w + x;
    const t = this.backType[i];
    if (t === T_AIR || TILE_TABLE[t].hp === 0) return false;
    const left = this.backHp[i] - amount;
    if (left <= 0) { this.backType[i] = T_AIR; this.backHp[i] = 0; this.dirty.push(i); this.removed.push(i); return true; }
    this.backHp[i] = left;
    this.dirty.push(i);
    return false;
  }
  /** 붕괴 등으로 앞 타일을 그냥 제거 (뒷벽 생성 없음) */
  clearFront(x: number, y: number): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    if (this.type[i] === T_AIR) return;
    this.type[i] = T_AIR; this.hp[i] = 0; this.team[i] = NO_TEAM;
    this.dirty.push(i);
    this.removed.push(i);
  }
  /** 앞 타일이 '고정점'인가: 파괴 불가(bedrock) 이거나 그 칸 또는 인접 4칸에 뒷벽이 있음 */
  isAnchor(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.w + x;
    if (TILE_TABLE[this.type[i]].hp === 0 && this.type[i] !== T_AIR) return true;
    return this.backType[i] !== T_AIR ||
      this.getBack(x - 1, y) !== T_AIR || this.getBack(x + 1, y) !== T_AIR ||
      this.getBack(x, y - 1) !== T_AIR || this.getBack(x, y + 1) !== T_AIR;
  }
  /** 이 칸이 이웃을 지지할 수 있는가 (나무 파츠는 지지대가 아님) */
  occupied(x: number, y: number): boolean {
    const t = this.get(x, y);
    return (t !== T_AIR && !TILE_TABLE[t].tree) || this.getBack(x, y) !== T_AIR;
  }
  isTree(x: number, y: number): boolean {
    return !!TILE_TABLE[this.get(x, y)].tree;
  }
  /** 인접 4방향 또는 자기 칸의 뒷벽에 지지대가 있는가 */
  supported(x: number, y: number): boolean {
    return this.getBack(x, y) !== T_AIR ||
      this.occupied(x - 1, y) || this.occupied(x + 1, y) || this.occupied(x, y - 1) || this.occupied(x, y + 1);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  idx(x: number, y: number): number {
    return y * this.w + x;
  }
  get(x: number, y: number): number {
    if (!this.inBounds(x, y)) return T_BEDROCK; // 맵 밖은 벽
    return this.type[y * this.w + x];
  }
  def(x: number, y: number): TileDef {
    return TILE_TABLE[this.get(x, y)];
  }
  teamAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return NO_TEAM;
    return this.team[y * this.w + x];
  }

  /** 특정 팀에게 고체인가 (팀 문은 아군에게 통과 가능) */
  solidFor(x: number, y: number, team: number): boolean {
    const t = this.get(x, y);
    const d = TILE_TABLE[t];
    if (!d.solid) return false;
    if (d.door && this.teamAt(x, y) === team) return false;
    return true;
  }
  isSolid(x: number, y: number): boolean {
    return TILE_TABLE[this.get(x, y)].solid;
  }
  isLadder(x: number, y: number): boolean {
    return !!TILE_TABLE[this.get(x, y)].ladder;
  }

  set(x: number, y: number, t: number, team = NO_TEAM): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.w + x;
    this.type[i] = t;
    this.hp[i] = TILE_TABLE[t].hp;
    this.team[i] = team;
    if (TILE_TABLE[t].solid) this.water[i] = 0;
    this.dirty.push(i);
  }

  /**
   * 타일에 피해. 파괴되면 true. 파괴 불가(hp 0)는 무시.
   * 파괴 시 인접 지지 검사(나뭇잎/사다리 등)는 하지 않음 (MVP).
   */
  damage(x: number, y: number, amount: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.w + x;
    const d = TILE_TABLE[this.type[i]];
    if (d.hp === 0 || this.type[i] === T_AIR) return false;
    const left = this.hp[i] - amount;
    if (left <= 0) {
      this.type[i] = T_AIR;
      this.hp[i] = 0;
      this.team[i] = NO_TEAM;
      // 자연 지형을 파면 흙 뒷벽이 남는다
      if (d.natural && this.backType[i] === T_AIR) { this.backType[i] = T_DIRT_BACK; this.backHp[i] = TILE_TABLE[T_DIRT_BACK].hp; }
      this.dirty.push(i);
      this.removed.push(i);
      return true;
    }
    this.hp[i] = left;
    this.dirty.push(i);
    return false;
  }

  /** 앞 타일 건설 가능: 앞이 비어 있고 지지대(뒷벽 또는 인접 타일)가 있어야 함. 엔티티 겹침은 호출자가 검사. */
  canPlace(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    if (this.type[y * this.w + x] !== T_AIR) return false;
    return this.supported(x, y);
  }
  /** 뒷벽 건설 가능: 뒤가 비어 있고 인접에 무언가 있어야 함 */
  canPlaceBack(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    if (this.backType[y * this.w + x] !== T_AIR) return false;
    return this.occupied(x - 1, y) || this.occupied(x + 1, y) || this.occupied(x, y - 1) || this.occupied(x, y + 1);
  }
}

/**
 * 지형 생성 (결정론적). 왼쪽 절반을 만든 뒤 오른쪽으로 거울 복사해 양 팀이 공평한 대칭 맵을 만든다.
 * - 기지: 양 끝 평지 + 작업장 1개
 * - 중앙: 금 광맥 집중 (지상 노출 금 포함)
 * - 나무: 캐노피가 지형/다른 나무에 닿지 않는 자리에만, 최소 간격 유지
 */
export function generateMap(map: TileMap, rng: Rng): { spawnX: number[]; groundY: Int32Array } {
  const { w, h } = map;
  const half = w >> 1;
  // 1. 높이맵 (왼쪽 절반): 저주파 제어점 + 선형 보간 + 잡음
  const step = 16;
  const ctrl: number[] = [];
  const base = (h * 2) / 5 | 0;
  for (let i = 0; i <= (half / step | 0) + 2; i++) ctrl.push(base + rng.range(-8, 8));
  const groundY = new Int32Array(w);
  for (let x = 0; x < half; x++) {
    const i = (x / step) | 0;
    const f = x - i * step;
    const a = ctrl[i];
    const b = ctrl[i + 1];
    let y = a + Math.floor(((b - a) * f) / step);
    y += rng.range(-1, 1);
    if (x < 24) y = base; // 기지 평지
    if (x >= half - 3) y = ctrl[(half / step) | 0]; // 중앙 이음새 평탄화
    groundY[x] = y;
  }
  // 1a. 열 사이 높이 차를 1칸 이하로 제한 (탈것이 오를 수 있는 경사; 더 큰 절벽은 동굴/호수/건설로만 생김)
  for (let x = 25; x < half; x++) {
    const prev = groundY[x - 1];
    if (groundY[x] > prev + 1) groundY[x] = prev + 1;
    else if (groundY[x] < prev - 1) groundY[x] = prev - 1;
  }
  for (let x = half - 3; x < half; x++) groundY[x] = groundY[half - 4]; // 중앙 이음새 평탄화 (거울 복사와 이어짐)
  // 1b. 1칸짜리 돌기/구덩이 제거: 양쪽 이웃보다 혼자 높거나 낮은 열은 이웃 높이에 맞춘다 (2회 반복)
  for (let pass = 0; pass < 2; pass++) {
    for (let x = 25; x < half - 3; x++) {
      const l = groundY[x - 1], r = groundY[x + 1], c = groundY[x];
      if (c < l && c < r) groundY[x] = l < r ? l : r; // 돌기 → 낮은 쪽(높은 이웃)에 맞춤
      else if (c > l && c > r) groundY[x] = l > r ? l : r; // 구덩이 → 메움
    }
  }
  // 2. 층 채우기 (왼쪽 절반)
  for (let x = 0; x < half; x++) {
    const gy = groundY[x];
    const stoneStart = gy + 6 + rng.range(0, 4);
    for (let y = 0; y < h; y++) {
      let t = T_AIR;
      if (y === h - 1) t = T_BEDROCK;
      else if (y >= stoneStart) t = T_STONE;
      else if (y > gy) t = T_DIRT;
      else if (y === gy) t = T_GRASS;
      if (t !== T_AIR) map.set(x, y, t);
      if (y > gy && y < h - 1) map.setBack(x, y, T_DIRT_BACK);
    }
  }
  // 3. 금 광맥: 중앙(half 근처)에 집중
  const veins = (half / 6) | 0;
  for (let v = 0; v < veins; v++) {
    const r1 = rng.range(28, half - 2), r2 = rng.range(28, half - 2);
    const cx = r1 > r2 ? r1 : r2; // 두 난수의 최댓값 → 중앙 편향
    const cy = rng.range(groundY[cx] + 6, h - 4);
    const n = rng.range(3, 8);
    for (let k = 0; k < n; k++) {
      const x = cx + rng.range(-2, 2);
      const y = cy + rng.range(-1, 1);
      if (map.get(x, y) === T_STONE || (map.get(x, y) === T_DIRT && cx > half - 24)) map.set(x, y, T_GOLD);
    }
  }
  // 중앙 지상 노출 금 (이음새 근처 표면 아래 1~2칸)
  for (let x = half - 8; x < half; x++) if (rng.int(3) === 0) map.set(x, groundY[x] + 1 + rng.int(2), T_GOLD);
  // 4. 동굴 (랜덤워크, 기지 제외)
  const caves = (half / 24) | 0;
  for (let c = 0; c < caves; c++) {
    let x = rng.range(32, half - 4);
    let y = rng.range(groundY[x] + 8, h - 6);
    const len = rng.range(15, 40);
    for (let k = 0; k < len; k++) {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (x + dx < half && map.get(x + dx, y + dy) !== T_BEDROCK) map.set(x + dx, y + dy, T_AIR);
      x += rng.range(-1, 1);
      y += rng.range(-1, 1);
      if (x < 30) x = 30;
      if (y < groundY[Math.max(0, Math.min(half - 1, x))] + 4) y += 2;
      if (y > h - 4) y = h - 4;
    }
  }
  // 5. 나무: 캐노피(5×4)와 트렁크 공간이 완전히 비어 있고 다른 나무와 겹치지 않는 자리에만
  let lastTree = -100;
  for (let x = 27; x < half - 4; x++) {
    if (x - lastTree < 7 || rng.int(3) !== 0) continue;
    const gy = groundY[x];
    if (map.get(x, gy) !== T_GRASS) continue;
    const th = rng.range(5, 8);
    const top = gy - th;
    let clear = true;
    for (let y = top - 2; y <= gy - 1 && clear; y++)
      for (let dx = -2; dx <= 2; dx++) if (map.get(x + dx, y) !== T_AIR) { clear = false; break; }
    if (!clear) continue;
    for (let y = gy - 1; y >= top; y--) map.set(x, y, T_TRUNK);
    for (let dy = -2; dy <= 1; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) === 2 && Math.abs(dy) === 2) continue;
        if (map.get(x + dx, top + dy) === T_AIR) map.set(x + dx, top + dy, T_LEAF);
      }
    lastTree = x;
  }
  // 6. 기지 작업장 (스폰 왼쪽 4칸, 지면 위)
  const spawnL = 12;
  map.set(spawnL - 4, groundY[spawnL - 4] - 1, tileIdByName('workshop'));
  // 7. 오른쪽 절반 = 왼쪽 거울
  for (let x = half; x < w; x++) {
    const sx = w - 1 - x;
    groundY[x] = groundY[sx];
    for (let y = 0; y < h; y++) {
      const si = y * w + sx, di = y * w + x;
      map.type[di] = map.type[si]; map.hp[di] = map.hp[si]; map.team[di] = map.team[si];
      map.backType[di] = map.backType[si]; map.backHp[di] = map.backHp[si];
    }
  }
  // 8. 중앙 호수: 이음새 주변을 파내고 물로 채움 (양쪽 대칭)
  const lakeHalf = 9, lakeDepth = 4;
  // 수면 = 호숫가(양 끝 열) 지면 높이. 그 위로 솟은 땅은 깎아내 물이 새지 않는 분지를 만든다
  const lakeY = Math.max(groundY[half - lakeHalf], groundY[half + lakeHalf]);
  for (let x = half - lakeHalf; x <= half + lakeHalf; x++) {
    const edge = lakeHalf - Math.abs(x - half);
    const depth = edge >= 3 ? lakeDepth : edge; // 가장자리는 얕게
    for (let y = groundY[x]; y < lakeY; y++) if (map.get(x, y) !== T_BEDROCK) { map.set(x, y, T_AIR); map.setBack(x, y, T_AIR); }
    if (groundY[x] < lakeY) { groundY[x] = lakeY; map.set(x, lakeY, T_GRASS); }
    for (let k = 0; k < depth; k++) {
      const y = lakeY + k;
      if (map.get(x, y) !== T_BEDROCK) { map.set(x, y, T_AIR); map.setBack(x, y, T_DIRT_BACK); map.water[y * w + x] = WATER_MAX; }
    }
    // 호수 위 나무/잎 제거
    for (let y = lakeY - 12; y < lakeY; y++) if (map.get(x, y) === T_TRUNK || map.get(x, y) === T_LEAF) map.set(x, y, T_AIR);
  }
  // 9. 검증: 밑동 아래가 고체가 아닌 나무(호수 등으로 땅이 사라진 경우)는 통째로 제거
  for (let x = 0; x < w; x++) {
    for (let y = h - 2; y >= 0; y--) {
      if (map.get(x, y) !== T_TRUNK || map.get(x, y + 1) === T_TRUNK) continue;
      if (map.isSolid(x, y + 1)) break; // 정상 밑동
      let top = y;
      while (map.get(x, top - 1) === T_TRUNK) top--;
      for (let ty = y; ty >= top; ty--) map.set(x, ty, T_AIR);
      for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) if (map.get(x + dx, top + dy) === T_LEAF) map.set(x + dx, top + dy, T_AIR);
      break;
    }
  }
  map.dirty.length = 0;
  map.removed.length = 0;
  return { spawnX: [spawnL, w - 1 - spawnL], groundY };
}

function tileIdByName(name: string): number {
  for (let i = 0; i < TILE_TABLE.length; i++) if (TILE_TABLE[i] && TILE_TABLE[i].name === name) return i;
  return T_AIR;
}
