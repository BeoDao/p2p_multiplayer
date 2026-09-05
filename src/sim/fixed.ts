/**
 * 고정소수점 정수 수학. 시뮬레이션 전체는 이 파일의 연산만 사용한다.
 * - 모든 값은 32비트 정수(|0)로 유지한다.
 * - 1 픽셀 = FP_ONE (256) 단위. 1 타일 = 8 px = TILE_FP 단위.
 * - 부동소수점(Math.sin, Math.sqrt 등)은 절대 사용하지 않는다 → 플랫폼 간 결정론 보장.
 */

export const FP_SHIFT = 8;
export const FP_ONE = 1 << FP_SHIFT; // 256
export const TILE_PX = 8;
export const TILE_SHIFT = FP_SHIFT + 3; // 11 → 2048 units per tile
export const TILE_FP = 1 << TILE_SHIFT;

/** px(정수) → FP */
export const px = (v: number): number => (v << FP_SHIFT) | 0;
/** FP → 정수 px (내림) */
export const toPx = (v: number): number => v >> FP_SHIFT;
/** FP → 타일 인덱스 (내림) */
export const toTile = (v: number): number => v >> TILE_SHIFT;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v) | 0;
export const iabs = (v: number): number => (v < 0 ? -v : v) | 0;
export const isign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const imin = (a: number, b: number): number => (a < b ? a : b) | 0;
export const imax = (a: number, b: number): number => (a > b ? a : b) | 0;

/** FP 곱: (a*b)>>8. 32비트 오버플로 방지를 위해 분할 곱셈 사용. */
export function fmul(a: number, b: number): number {
  // a*b 가 2^53 이내면 JS 배정밀도로 정확하므로 Math.floor 로 결정론적으로 계산 가능.
  // |a|,|b| < 2^26 이면 안전. 시뮬 값은 그 범위 안에 있음.
  return Math.floor((a * b) / FP_ONE) | 0;
}
/** FP 나눗셈: (a<<8)/b (0 방향이 아닌 내림) */
export function fdiv(a: number, b: number): number {
  return Math.floor((a * FP_ONE) / b) | 0;
}
/** 정수 나눗셈(내림) */
export function idiv(a: number, b: number): number {
  return Math.floor(a / b) | 0;
}

/** 정수 제곱근(내림). 입력은 0 이상 2^53 이하의 정수. 뉴턴 반복, 결정론적. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  // 초기 추정: 비트 길이 기반
  let x = 1;
  let t = n;
  while (t > 1) {
    t = Math.floor(t / 4);
    x *= 2;
  }
  // x >= sqrt(n) 보장 후 감소 반복
  x = x * 2;
  for (;;) {
    const y = Math.floor((x + Math.floor(n / x)) / 2);
    if (y >= x) return x;
    x = y;
  }
}

/** 벡터 길이 (FP 단위, 내림) */
export function vlen(x: number, y: number): number {
  return isqrt(x * x + y * y);
}

/**
 * 벡터를 지정 길이(FP)로 정규화. 결과는 정수. (0,0) 이면 (len,0).
 */
export function vnorm(x: number, y: number, len: number): [number, number] {
  const l = vlen(x, y);
  if (l === 0) return [len, 0];
  return [Math.floor((x * len) / l) | 0, Math.floor((y * len) / l) | 0];
}

/**
 * 이진각(BAM): 0..4095 가 한 바퀴. 정수 CORDIC 으로 sin/cos 테이블을 생성한다.
 * 결과는 -4096..4096 (SIN_ONE = 4096) 스케일.
 */
export const BAM_FULL = 4096;
export const SIN_ONE = 4096;
const SIN_TABLE = new Int32Array(BAM_FULL);
const COS_TABLE = new Int32Array(BAM_FULL);

(function buildTrig() {
  // CORDIC, 각도 단위: 2^30 = 90도 (사분면 내부에서만 회전)
  // atan(2^-i) * (2^30 / (pi/2)) 를 정수로 하드코딩 (i=0..23)
  const ATAN = [
    536870912, 316933406, 167458907, 85004756, 42667331, 21354465, 10679838, 5340245, 2670163,
    1335087, 667544, 333772, 166886, 83443, 41721, 20860, 10430, 5215, 2607, 1303, 651, 325, 162,
    81,
  ];
  // CORDIC 이득 K = 0.607252935... → 스케일 2^28 로 표현
  const K = 163008218; // round(0.6072529350088813 * 2^28)
  const SCALE = 1 << 28;
  const quarter = BAM_FULL >> 2; // 1024
  for (let a = 0; a <= quarter; a++) {
    // 목표 각도 (2^30 = 90도 스케일)
    const target = Math.floor((a * 1073741824) / quarter);
    let x = K; // cos 누적(2^28)
    let y = 0;
    let z = 0;
    for (let i = 0; i < 24; i++) {
      const dx = Math.floor(x / 2 ** i); // 산술 시프트 (부호 있는 내림)
      const dy = Math.floor(y / 2 ** i);
      if (z < target) {
        x = x - dy;
        y = y + dx;
        z = z + ATAN[i];
      } else {
        x = x + dy;
        y = y - dx;
        z = z - ATAN[i];
      }
    }
    // 2^28 스케일 → 4096 스케일 (반올림)
    const s = Math.floor((y * SIN_ONE + SCALE / 2) / SCALE);
    const c = Math.floor((x * SIN_ONE + SCALE / 2) / SCALE);
    const sc = clamp(s, 0, SIN_ONE);
    const cc = clamp(c, 0, SIN_ONE);
    SIN_TABLE[a] = sc;
    COS_TABLE[a] = cc;
    // 대칭으로 나머지 사분면 채우기
    SIN_TABLE[(2 * quarter - a) & (BAM_FULL - 1)] = sc;
    COS_TABLE[(2 * quarter - a) & (BAM_FULL - 1)] = -cc;
    SIN_TABLE[(2 * quarter + a) & (BAM_FULL - 1)] = -sc;
    COS_TABLE[(2 * quarter + a) & (BAM_FULL - 1)] = -cc;
    SIN_TABLE[(4 * quarter - a) & (BAM_FULL - 1)] = -sc;
    COS_TABLE[(4 * quarter - a) & (BAM_FULL - 1)] = cc;
  }
  SIN_TABLE[0] = 0;
  COS_TABLE[0] = SIN_ONE;
  SIN_TABLE[quarter] = SIN_ONE;
  COS_TABLE[quarter] = 0;
  SIN_TABLE[2 * quarter] = 0;
  COS_TABLE[2 * quarter] = -SIN_ONE;
  SIN_TABLE[3 * quarter] = -SIN_ONE;
  COS_TABLE[3 * quarter] = 0;
})();

export const bsin = (a: number): number => SIN_TABLE[a & (BAM_FULL - 1)];
export const bcos = (a: number): number => COS_TABLE[a & (BAM_FULL - 1)];

/** 정수 atan2 → BAM (0..4095). 이진 탐색 기반, 결정론적. y 는 아래가 양수(스크린 좌표). */
export function batan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  // 사분면 분리 후 0..1024 범위를 이진 탐색: 후보 각도 a 에 대해 sin(a)*x - cos(a)*y 의 부호로 판별
  const ax = iabs(x);
  const ay = iabs(y);
  let lo = 0;
  let hi = 1024;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    // 각 mid 의 탄젠트가 ay/ax 보다 큰가?  sin(mid)*ax > cos(mid)*ay
    if (SIN_TABLE[mid] * ax > COS_TABLE[mid] * ay) hi = mid;
    else lo = mid;
  }
  let a = lo;
  if (x < 0) a = 2048 - a;
  if (y < 0) a = (4096 - a) & 4095;
  return a & 4095;
}

/** 두 AABB 겹침 검사 (좌상단 + 크기, FP) */
export function aabbOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
