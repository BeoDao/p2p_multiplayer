/**
 * 플레이어 입력. 틱마다 9바이트로 직렬화되어 P2P 로 전송된다 (4바이트 조작 + 5바이트 개발용 치트 코드/인자).
 * cx, cy: 플레이어 중심 기준 커서 오프셋(px, -128..127). 조준 방향과 건설 위치 모두 이것으로 결정.
 */
export const BTN_LEFT = 1 << 0;
export const BTN_RIGHT = 1 << 1;
export const BTN_UP = 1 << 2;
export const BTN_DOWN = 1 << 3;
export const BTN_JUMP = 1 << 4;
export const BTN_ACTION1 = 1 << 5; // 좌클릭: 공격/파괴/설치
export const BTN_ACTION2 = 1 << 6; // 우클릭: 방패/특수
export const BTN_USE = 1 << 7; // 상호작용(직업 변경 등)

export interface Input {
  buttons: number; // u8
  cx: number; // i8
  cy: number; // i8
  slot: number; // 0..15 핫바 슬롯
  cls: number; // 0..3 직업 변경 요청 (3 = 없음)
  cheat?: number; // [DEV] 치트 코드 u8 (dev/cheats.ts 참조). 출시 전 world.ts CHEATS_ENABLED=false
  a0?: number; // [DEV] 치트 인자 i16
  a1?: number; // [DEV] 치트 인자 i16
}

export const EMPTY_INPUT: Readonly<Input> = Object.freeze({ buttons: 0, cx: 0, cy: 0, slot: 0, cls: 3, cheat: 0, a0: 0, a1: 0 });
export const INPUT_BYTES = 9;

export function encodeInput(i: Input, out: Uint8Array, off: number): void {
  out[off] = i.buttons & 0xff;
  out[off + 1] = i.cx & 0xff;
  out[off + 2] = i.cy & 0xff;
  out[off + 3] = ((i.slot & 0xf) | ((i.cls & 3) << 4)) & 0xff;
  out[off + 4] = (i.cheat ?? 0) & 0xff;
  const a0 = (i.a0 ?? 0) & 0xffff, a1 = (i.a1 ?? 0) & 0xffff;
  out[off + 5] = a0 & 0xff; out[off + 6] = a0 >> 8;
  out[off + 7] = a1 & 0xff; out[off + 8] = a1 >> 8;
}

export function decodeInput(buf: Uint8Array, off: number): Input {
  return {
    buttons: buf[off],
    cx: (buf[off + 1] << 24) >> 24,
    cy: (buf[off + 2] << 24) >> 24,
    slot: buf[off + 3] & 0xf,
    cls: (buf[off + 3] >> 4) & 3,
    cheat: buf[off + 4],
    a0: ((buf[off + 5] | (buf[off + 6] << 8)) << 16) >> 16,
    a1: ((buf[off + 7] | (buf[off + 8] << 8)) << 16) >> 16,
  };
}

export function inputEquals(a: Input, b: Input): boolean {
  return a.buttons === b.buttons && a.cx === b.cx && a.cy === b.cy && a.slot === b.slot && a.cls === b.cls && (a.cheat ?? 0) === (b.cheat ?? 0) && (a.a0 ?? 0) === (b.a0 ?? 0) && (a.a1 ?? 0) === (b.a1 ?? 0);
}
