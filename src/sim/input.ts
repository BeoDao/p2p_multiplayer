/**
 * 플레이어 입력. 틱마다 5바이트로 직렬화되어 P2P 로 전송된다.
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
  cheat?: number; // 개발용 치트 요청 (1 = 자원 지급, 2 = 타일 즉사 토글). 출시 전 제거 — world.ts CHEATS_ENABLED
}

export const EMPTY_INPUT: Readonly<Input> = Object.freeze({ buttons: 0, cx: 0, cy: 0, slot: 0, cls: 3, cheat: 0 });
export const INPUT_BYTES = 4;

export function encodeInput(i: Input, out: Uint8Array, off: number): void {
  out[off] = i.buttons & 0xff;
  out[off + 1] = i.cx & 0xff;
  out[off + 2] = i.cy & 0xff;
  out[off + 3] = ((i.slot & 0xf) | ((i.cls & 3) << 4) | (((i.cheat ?? 0) & 3) << 6)) & 0xff;
}

export function decodeInput(buf: Uint8Array, off: number): Input {
  return {
    buttons: buf[off],
    cx: (buf[off + 1] << 24) >> 24,
    cy: (buf[off + 2] << 24) >> 24,
    slot: buf[off + 3] & 0xf,
    cls: (buf[off + 3] >> 4) & 3,
    cheat: (buf[off + 3] >> 6) & 3,
  };
}

export function inputEquals(a: Input, b: Input): boolean {
  return a.buttons === b.buttons && a.cx === b.cx && a.cy === b.cy && a.slot === b.slot && a.cls === b.cls && (a.cheat ?? 0) === (b.cheat ?? 0);
}
