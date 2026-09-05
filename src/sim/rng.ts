/** 결정론적 PRNG (xorshift32). 상태는 월드 스냅샷에 포함되어 동기화된다. */
export class Rng {
  state: number;
  constructor(seed: number) {
    this.state = (seed | 0) || 0x9e3779b9;
  }
  /** 0 이상 2^31 미만의 정수 */
  next(): number {
    let x = this.state | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return (x >>> 1) | 0;
  }
  /** [0, n) */
  int(n: number): number {
    return this.next() % n;
  }
  /** [lo, hi] */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }
}

/** FNV-1a 32비트 해시 (상태 검증용) */
export function fnv1a(bytes: Uint8Array, seed = 0x811c9dc5): number {
  let h = seed | 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
