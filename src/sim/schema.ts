/**
 * 스키마 기반 직렬화. 엔티티마다 필드 표 하나만 유지하면 write/read/hash 가 자동으로 맞는다.
 * 필드를 빠뜨리면 tests/schema.test.ts 가 잡는다 (실제 객체의 키 집합 == 스키마 키 집합).
 *
 * 타입: i32 | u8 | bool | str | obj(하위 스키마)
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

export type FieldType = 'i32' | 'u8' | 'bool' | 'str' | { obj: Schema };
export type Schema = [string, FieldType][];

export class Writer {
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
  u16(v: number): void { this.ensure(2); this.view.setUint16(this.pos, v & 0xffff, true); this.pos += 2; }
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
  raw(b: Uint8Array): void { this.ensure(b.length); this.buf.set(b, this.pos); this.pos += b.length; }
  obj<T extends object>(schema: Schema, o: T): void {
    const rec = o as unknown as Record<string, unknown>;
    for (const [k, t] of schema) {
      const v = rec[k];
      if (t === 'i32') this.i32((v as number) ?? 0);
      else if (t === 'u8') this.u8((v as number) ?? 0);
      else if (t === 'bool') this.bool(!!v);
      else if (t === 'str') this.str((v as string) ?? '');
      else this.obj(t.obj, (v as object) ?? {});
    }
  }
  done(): Uint8Array { return this.buf.slice(0, this.pos); }
}

export class Reader {
  view: DataView;
  pos = 0;
  constructor(public buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  get remaining(): number { return this.buf.length - this.pos; }
  u8(): number { return this.buf[this.pos++]; }
  u16(): number { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i32(): number { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  bool(): boolean { return this.u8() !== 0; }
  str(): string { const n = this.u8(); const s = dec.decode(this.buf.subarray(this.pos, this.pos + n)); this.pos += n; return s; }
  bytes(): Uint8Array { const n = this.i32(); const b = this.buf.slice(this.pos, this.pos + n); this.pos += n; return b; }
  raw(n: number): Uint8Array { const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  obj<T extends object>(schema: Schema): T {
    const o: Record<string, unknown> = {};
    for (const [k, t] of schema) {
      if (t === 'i32') o[k] = this.i32();
      else if (t === 'u8') o[k] = this.u8();
      else if (t === 'bool') o[k] = this.bool();
      else if (t === 'str') o[k] = this.str();
      else o[k] = this.obj(t.obj);
    }
    return o as unknown as T;
  }
}

/** 스키마의 키 목록 (테스트용) */
export function schemaKeys(s: Schema): string[] { return s.map(([k]) => k); }
