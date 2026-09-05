import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { WATER_MAX } from '../src/sim/tilemap';
import { BTN_ACTION1, BTN_ACTION2, BTN_USE, EMPTY_INPUT, type Input } from '../src/sim/input';
import { PlayerState } from '../src/sim/types';
import { px } from '../src/sim/fixed';
import { serializeWorld, deserializeWorld, hashWorld } from '../src/sim/serialize';
import { T_AIR, T_DIRT_BACK, tileId } from '../src/data/defs';

function setup(): World {
  const w = new World(42);
  w.step({ inputs: new Map(), joins: [{ pid: 1, name: 'a', team: 0 }, { pid: 2, name: 'b', team: 1 }], leaves: [] });
  for (let i = 0; i < 3; i++) w.step({ inputs: new Map(), joins: [], leaves: [] });
  const a = w.getPlayer(1)!, b = w.getPlayer(2)!;
  // b 를 a 옆으로 이동 (같은 지면)
  b.x = a.x + px(10); b.y = a.y; b.vx = 0; b.vy = 0;
  return w;
}
const run = (w: World, n: number, inputs: Record<number, Input>): void => {
  for (let i = 0; i < n; i++) w.step({ inputs: new Map(Object.entries(inputs).map(([k, v]) => [Number(k), v])), joins: [], leaves: [] });
};

describe('combat rules', () => {
  it('knight slash damages enemy in front, shield blocks from front', () => {
    const w = setup();
    const a = w.getPlayer(1)!, b = w.getPlayer(2)!;
    const hp0 = b.hp;
    run(w, 8, { 1: { buttons: BTN_ACTION1, cx: 10, cy: 0, slot: 0, cls: 3 } });
    expect(b.hp).toBeLessThan(hp0);
    // b 가 a 를 바라보며 방패 → 막힘
    const hp1 = b.hp;
    b.facing = -1;
    run(w, 30, { 1: { ...EMPTY_INPUT, cx: 10 }, 2: { buttons: BTN_ACTION2, cx: -10, cy: 0, slot: 0, cls: 3 } });
    run(w, 8, { 1: { buttons: BTN_ACTION1, cx: 10, cy: 0, slot: 0, cls: 3 }, 2: { buttons: BTN_ACTION2, cx: -10, cy: 0, slot: 0, cls: 3 } });
    expect(b.hp).toBe(hp1);
    void a;
  });

  it('repeated slashes kill and respawn the victim, kill counted', () => {
    const w = setup();
    const a = w.getPlayer(1)!, b = w.getPlayer(2)!;
    const bx = b.x, by = b.y;
    for (let k = 0; k < 6 && b.state === PlayerState.Alive; k++) {
      b.x = bx; b.y = by; b.vx = 0; b.vy = 0;
      run(w, 14, { 1: { buttons: BTN_ACTION1, cx: 10, cy: 0, slot: 0, cls: 3 } });
    }
    expect(b.state).toBe(PlayerState.Dead);
    expect(a.kills).toBe(1);
    expect(b.deaths).toBe(1);
    run(w, 130, {});
    expect(b.state).toBe(PlayerState.Alive);
    expect(b.hp).toBeGreaterThan(0);
  });

  it('archer arrow hits enemy; bomb explodes and destroys tiles', () => {
    const w = setup();
    const a = w.getPlayer(1)!, b = w.getPlayer(2)!;
    a.cls = 1; a.arrows = 10; a.slot = 0;
    const hp0 = b.hp;
    run(w, 20, { 1: { buttons: BTN_ACTION1, cx: 10, cy: 0, slot: 0, cls: 3 } }); // 당김
    run(w, 1, { 1: { ...EMPTY_INPUT, cx: 10 } }); // 발사
    run(w, 10, { 1: { ...EMPTY_INPUT, cx: 10 } });
    expect(b.hp).toBeLessThan(hp0);
    expect(a.arrows).toBe(9);

    // 폭탄
    a.cls = 0; a.bombs = 2; a.slot = 1;
    const solidBefore = w.map.type.reduce((s, t) => s + (t ? 1 : 0), 0);
    // 투척은 게이지: 누르고(10틱) 놓으면 던진다
    run(w, 10, { 1: { buttons: BTN_ACTION1, cx: 0, cy: 10, slot: 1, cls: 3 } });
    expect(a.bombs).toBe(2);
    run(w, 1, { 1: { ...EMPTY_INPUT, cy: 10, slot: 1 } });
    expect(a.bombs).toBe(1);
    run(w, 100, {});
    const solidAfter = w.map.type.reduce((s, t) => s + (t ? 1 : 0), 0);
    expect(solidAfter).toBeLessThan(solidBefore);
  });

  it('builder digs and builds with resources; team door passable only for own team', () => {
    const w = setup();
    const a = w.getPlayer(1)!;
    a.cls = 2; a.slot = 0;
    // 나무 블록 설치 (자원 지급)
    a.wood = 100;
    const before = w.map.type.reduce((s, t) => s + (t ? 1 : 0), 0);
    run(w, 3, { 1: { buttons: BTN_ACTION1, cx: 24, cy: 2, slot: 1, cls: 3 } });
    expect(w.map.type.reduce((s, t) => s + (t ? 1 : 0), 0)).toBeGreaterThan(before);
    expect(a.wood).toBe(90);
    // 문
    a.wood = 100;
    run(w, 12, { 1: { buttons: BTN_ACTION1, cx: 22, cy: -6, slot: 4, cls: 3 } });
    const doorIdx = w.map.type.findIndex((t) => t === 11);
    expect(doorIdx).toBeGreaterThanOrEqual(0);
    const dx = doorIdx % w.map.w, dy = (doorIdx / w.map.w) | 0;
    expect(w.map.solidFor(dx, dy, 0)).toBe(false);
    expect(w.map.solidFor(dx, dy, 1)).toBe(true);
    // 아래 타일 파기
    const tilesBefore = w.map.type.reduce((s, t) => s + (t ? 1 : 0), 0);
    run(w, 40, { 1: { buttons: BTN_ACTION1, cx: 0, cy: 14, slot: 0, cls: 3 } });
    expect(w.map.type.reduce((s, t) => s + (t ? 1 : 0), 0)).toBeLessThan(tilesBefore);
  });

  it('no hitting or digging through walls', () => {
    const w = setup();
    const a = w.getPlayer(1)!, b = w.getPlayer(2)!;
    // a 와 b 사이에 돌 벽 세우기 (b 는 a 의 10px 오른쪽 → 그 사이 타일 열)
    const wallX = ((a.x >> 8) + 3 + 5) >> 3;
    const topY = a.y >> 11;
    for (let ty = topY - 1; ty <= topY + 2; ty++) w.map.set(wallX, ty, 9);
    b.x = a.x + px(14); // 벽 너머
    const hp0 = b.hp;
    run(w, 8, { 1: { buttons: BTN_ACTION1, cx: 14, cy: 0, slot: 0, cls: 3 } });
    expect(b.hp).toBe(hp0);
    // 건축가: 벽 너머 타일을 파려고 하면 벽이 대신 깎임
    a.cls = 2; a.slot = 0;
    run(w, 12, {});
    const rowY = (a.y + px(7)) >> 11;
    const wallHp = w.map.hp[rowY * w.map.w + wallX];
    const farX = wallX + 2, farT = w.map.get(farX, rowY);
    run(w, 1, { 1: { buttons: BTN_ACTION1, cx: 20, cy: 0, slot: 0, cls: 3 } });
    expect(w.map.hp[rowY * w.map.w + wallX]).toBe(wallHp - 1);
    expect(w.map.get(farX, rowY)).toBe(farT);
    // 벽 너머에 블록 설치 불가
    a.wood = 100;
    const before = w.map.type.reduce((s, t) => s + (t ? 1 : 0), 0);
    run(w, 10, { 1: { buttons: BTN_ACTION1, cx: 20, cy: -2, slot: 1, cls: 3 } });
    expect(w.map.type.reduce((s, t) => s + (t ? 1 : 0), 0)).toBe(before);
  });

  it('digging natural tiles leaves dirt back wall; back wall supports building and can be dug', () => {
    const w = setup();
    const a = w.getPlayer(1)!;
    a.cls = 2; a.slot = 0; a.wood = 100;
    const cxT = (a.x + px(3)) >> 11, rowY = (a.y + px(7)) >> 11;
    // 아래 지면(잔디) 파기
    const belowY = rowY + 1;
    expect(w.map.getBack(cxT, belowY)).toBe(T_AIR); // 지표면 자체는 뒷벽 없음
    run(w, 30, { 1: { buttons: BTN_ACTION1, cx: 0, cy: 12, slot: 0, cls: 3 } });
    expect(w.map.get(cxT, belowY)).toBe(T_AIR);
    expect(w.map.getBack(cxT, belowY)).toBe(T_DIRT_BACK);
    // 지하 자연 타일은 생성 시부터 뒷벽 보유
    expect(w.map.getBack(cxT, belowY + 3)).toBe(T_DIRT_BACK);
    // 공중(지지대 없음)에는 설치 불가, 뒷벽 위에는 인접 타일 없어도 설치 가능
    const farX = cxT + 3, airY = rowY - 4;
    expect(w.map.canPlace(farX, airY)).toBe(false);
    w.map.setBack(farX, airY, T_DIRT_BACK);
    expect(w.map.canPlace(farX, airY)).toBe(true);
    // 흙 뒷벽은 어떤 방법으로도 제거되지 않는다 (곡괭이질해도 그대로)
    run(w, 5, {});
    const px2 = (a.x + px(3)) >> 11, py2 = (a.y + px(7)) >> 11;
    if (w.map.getBack(px2, py2) === T_DIRT_BACK && w.map.get(px2, py2) === T_AIR) {
      run(w, 40, { 1: { buttons: BTN_ACTION1, cx: 0, cy: 0, slot: 0, cls: 3 } });
      expect(w.map.getBack(px2, py2)).toBe(T_DIRT_BACK);
      expect(w.map.damageBack(px2, py2, 99)).toBe(false);
      expect(w.map.getBack(px2, py2)).toBe(T_DIRT_BACK);
    }
    // 나무 뒷벽 설치: 뒤가 비어 있고 인접에 무언가 있으면 가능
    const wb = tileId('wood_back');
    w.map.setBack(px2, py2, T_AIR);
    expect(w.map.canPlaceBack(px2, py2)).toBe(true);
    w.map.setBack(px2, py2, wb);
    expect(w.map.getBack(px2, py2)).toBe(wb);
    expect(w.map.canPlaceBack(px2, py2)).toBe(false);
  });

  it('tile physics: unsupported cluster collapses sequentially from the break point', () => {
    const w = setup();
    const a = w.getPlayer(1)!;
    const cxT = (a.x + px(3)) >> 11, rowY = (a.y + px(7)) >> 11;
    const gy = rowY + 1; // 잔디
    const colX = cxT + 4;
    // 지면 위 나무 블록 기둥 4개 (뒷벽 없음, 잔디에만 연결)
    for (let k = 1; k <= 4; k++) w.map.set(colX, gy - k, 8);
    run(w, 1, {});
    expect(w.collapses.length).toBe(0);
    // 맨 아래 블록 제거 → 나머지 3개가 순차 붕괴
    w.map.damage(colX, gy - 1, 99);
    run(w, 1, {});
    expect(w.collapses.length).toBe(6); // 3개 × [idx, at]
    const t0 = w.tick;
    run(w, 2, {});
    expect(w.map.get(colX, gy - 2)).toBe(T_AIR); // 거리 1: 먼저
    expect(w.map.get(colX, gy - 3)).toBe(8);     // 거리 2: 아직
    run(w, 2, {});
    expect(w.map.get(colX, gy - 3)).toBe(T_AIR);
    run(w, 2, {});
    expect(w.map.get(colX, gy - 4)).toBe(T_AIR);
    expect(w.collapses.length).toBe(0);
    void t0;
    // 땅 파기는 붕괴를 일으키지 않음 (뒷벽에 고정)
    w.map.damage(cxT + 6, gy, 99);
    run(w, 1, {});
    expect(w.collapses.length).toBe(0);
    // 나무: 모든 나무에 대해 밑동을 자르면 그 나무 전체가 무너짐 (캐노피가 언덕에 닿아 있어도)
    const trunks: [number, number][] = [];
    for (let x = 0; x < w.map.w; x++) for (let y = 0; y < w.map.h; y++) if (w.map.get(x, y) === 6 && w.map.get(x, y + 1) !== 6) trunks.push([x, y]);
    expect(trunks.length).toBeGreaterThan(3);
    for (const [tx, ty] of trunks) w.map.damage(tx, ty, 99);
    run(w, 80, {});
    expect(w.map.type.reduce((s, t) => s + (t === 6 || t === 7 ? 1 : 0), 0)).toBe(0);
    // 나무 파츠는 지지대가 아님: 잎 옆 공중에는 설치 불가
    const w2 = setup();
    const leafIdx = w2.map.type.findIndex((t) => t === 7);
    const lx = leafIdx % w2.map.w, ly = (leafIdx / w2.map.w) | 0;
    if (w2.map.get(lx, ly - 1) === T_AIR) expect(w2.map.canPlace(lx, ly - 1)).toBe(false);
  });

  it('workshop: buy with gold, heal while standing; players push each other apart', () => {
    const w = setup();
    const a = w.getPlayer(1)!, b = w.getPlayer(2)!;
    // 작업장 타일을 a 의 발 밑 칸에 (플레이어와 겹치는 비고체 타일)
    const tx = (a.x + px(3)) >> 11, ty = (a.y + px(7)) >> 11;
    w.map.set(tx, ty, tileId('workshop'));
    a.gold = 10; a.bombs = 0; a.hp = 4;
    run(w, 1, { 1: { buttons: BTN_USE, cx: 0, cy: 0, slot: 0, cls: 3 } });
    expect(a.bombs).toBe(1);
    expect(a.gold).toBe(6);
    // 홀드는 재구매 없음, 다시 눌러야 구매
    run(w, 5, { 1: { buttons: BTN_USE, cx: 0, cy: 0, slot: 0, cls: 3 } });
    expect(a.bombs).toBe(1);
    run(w, 1, {});
    run(w, 1, { 1: { buttons: BTN_USE, cx: 0, cy: 0, slot: 0, cls: 3 } });
    expect(a.bombs).toBe(2);
    expect(a.gold).toBe(2);
    run(w, 1, {}); run(w, 1, { 1: { buttons: BTN_USE, cx: 0, cy: 0, slot: 0, cls: 3 } });
    expect(a.bombs).toBe(2); // 금 부족
    // 회복
    const hp0 = a.hp;
    run(w, 95, {});
    expect(a.hp).toBeGreaterThan(hp0);
    // 밀치기: b 를 a 위에 겹치게 두면 서로 벌어짐
    b.x = a.x + px(2); b.y = a.y;
    run(w, 10, {});
    expect(Math.abs(b.x - a.x)).toBeGreaterThan(px(2));
  });

  it('tiles next to a back wall are anchored; dig cheat toggles one-hit digging', () => {
    const w = setup();
    const a = w.getPlayer(1)!;
    const cxT = (a.x + px(3)) >> 11, rowY = (a.y + px(7)) >> 11;
    // 공중에 뒷벽 하나, 그 옆(뒷벽 없는 칸)에 블록 → 붕괴하지 않아야 함
    const bx = cxT + 6, by = rowY - 5;
    w.map.setBack(bx, by, T_DIRT_BACK);
    expect(w.map.canPlace(bx + 1, by)).toBe(true);
    w.map.set(bx + 1, by, 8);
    w.map.set(bx + 2, by, 8);
    // 무언가 제거해서 검사 유발: 옆의 두 번째 블록 제거 후 첫 블록은 남아야 함
    w.map.damage(bx + 2, by, 99);
    run(w, 5, {});
    expect(w.map.get(bx + 1, by)).toBe(8);
    expect(w.collapses.length).toBe(0);
    // 뒷벽을 제거하면 그 옆 블록은 무너짐 (흙 뒷벽은 파괴 불가이므로 나무 뒷벽으로 바꿔 놓고 제거)
    w.map.setBack(bx, by, tileId('wood_back'));
    w.map.damageBack(bx, by, 99);
    run(w, 8, {});
    expect(w.map.get(bx + 1, by)).toBe(T_AIR);
    // 즉사 치트
    a.cls = 2; a.slot = 0;
    run(w, 1, { 1: { ...EMPTY_INPUT, cheat: 2 } });
    expect(a.digCheat).toBe(1);
    const ty = rowY + 1;
    run(w, 1, { 1: { buttons: BTN_ACTION1, cx: 0, cy: 12, slot: 0, cls: 3 } });
    expect(w.map.get(cxT, ty)).toBe(T_AIR);
    run(w, 1, {}); run(w, 1, { 1: { ...EMPTY_INPUT, cheat: 2 } });
    expect(a.digCheat).toBe(0);
  });

  it('death drops carried resources; survivors can pick them up', () => {
    const w = setup();
    const a = w.getPlayer(1)!, b = w.getPlayer(2)!;
    b.wood = 40; b.stone = 30; b.gold = 5;
    // b 를 검으로 죽임
    const bx = b.x, by = b.y;
    for (let k = 0; k < 6 && b.state === PlayerState.Alive; k++) {
      b.x = bx; b.y = by; b.vx = 0; b.vy = 0;
      run(w, 14, { 1: { buttons: BTN_ACTION1, cx: 10, cy: 0, slot: 0, cls: 3 } });
    }
    expect(b.state).toBe(PlayerState.Dead);
    expect(b.wood + b.stone + b.gold).toBe(0);
    expect(w.drops.length).toBe(4); // 나무/돌/금 + 기사 폭탄
    // a 가 드롭 위로 이동해 줍기 (드롭이 땅에 떨어질 때까지 진행)
    run(w, 40, {});
    a.bombs = 0;
    for (const d of [...w.drops]) { a.x = d.x - px(3); a.y = d.y - px(7); a.vx = 0; a.vy = 0; run(w, 2, {}); }
    run(w, 2, {});
    expect(w.drops.length).toBe(0);
    expect(a.bombs).toBeGreaterThan(0);
    expect(a.wood).toBe(40); expect(a.stone).toBe(30); expect(a.gold).toBe(5);
  });

  it('water: conserved while flowing, fills a dug hole from the lake, player swims and can drown', () => {
    const w = setup();
    const total = () => w.map.water.reduce((s, v) => s + v, 0);
    const t0 = total();
    expect(t0).toBeGreaterThan(0);
    run(w, 60, {});
    expect(total()).toBe(t0);
    // 호수 옆 벽을 파면 물이 새어 나옴
    const half = w.map.w >> 1;
    let ly = 0; while (w.map.water[ly * w.map.w + half] === 0) ly++;
    const bottom = ly + 3;
    let lx = half; while (w.map.water[bottom * w.map.w + lx] > 0) lx++; // 호수 오른쪽 벽
    w.map.damage(lx, bottom, 99); w.map.damage(lx + 1, bottom, 99); w.map.damage(lx + 1, bottom + 1, 99);
    run(w, 60, {});
    expect(w.map.water[(bottom + 1) * w.map.w + lx + 1]).toBeGreaterThan(0);
    expect(total()).toBe(t0);
    // 수영: 플레이어를 호수 중앙에 두면 가라앉지 않고, 점프로 떠오름
    const a = w.getPlayer(1)!;
    a.x = (half << 11); a.y = ((ly + 1) << 11); a.vx = 0; a.vy = 0;
    run(w, 30, {});
    expect(a.inWater).toBe(true);
    expect(a.state).toBe(PlayerState.Alive);
    const yBefore = a.y;
    run(w, 10, { 1: { buttons: 16, cx: 0, cy: 0, slot: 0, cls: 3 } });
    expect(a.y).toBeLessThan(yBefore);
    // 익사: 오래 잠수하면 피해
    for (let yy = ly; yy <= ly + 3; yy++) for (let xx = half - 2; xx <= half + 2; xx++) w.map.water[yy * w.map.w + xx] = WATER_MAX;
    a.x = (half << 11); a.y = ((ly + 2) << 11); a.breath = 5;
    const hp0 = a.hp;
    run(w, 40, { 1: { buttons: 8, cx: 0, cy: 0, slot: 0, cls: 3 } }); // 아래로
    expect(a.hp).toBeLessThan(hp0);
  });

  it('CTF: carrying enemy flag home scores; 3 captures end round', () => {
    const w = setup();
    const a = w.getPlayer(1)!;
    const b = w.getPlayer(2)!;
    b.x = w.flags[1].x + px(20); b.y = w.flags[1].y - px(7); b.vx = 0; b.vy = 0; // 상대는 자기 기지에
    for (let s = 0; s < 3; s++) {
      const ef = w.flags[1];
      a.x = ef.x - px(3); a.y = ef.y - px(7); a.vx = 0; a.vy = 0;
      run(w, 2, {});
      expect(a.carryingFlag).toBe(1);
      const hf = w.flags[0];
      a.x = hf.x - px(3); a.y = hf.y - px(7); a.vx = 0; a.vy = 0;
      run(w, 2, {});
      expect(a.carryingFlag).toBe(-1);
      expect(w.score[0]).toBe(s + 1);
    }
    expect(w.roundOverAt).toBeGreaterThan(0);
    run(w, 250, {});
    expect(w.round).toBe(2);
    expect(w.score[0]).toBe(0);
  });

  it('chopping a tree trunk drops a log item instead of giving wood directly; walking over it picks it up', () => {
    const w = setup();
    const a = w.getPlayer(1)!;
    a.cls = 2; a.state = PlayerState.Alive; a.hp = 8;
    // 플레이어 발밑에 바닥, 옆에 나무 기둥 하나
    const tx = (a.x >> 11) + 2, ty = a.y >> 11;
    w.map.set(tx, ty, tileId('tree_trunk'));
    w.map.set(tx, ty + 1, tileId('dirt'));
    a.wood = 0;
    const before = w.drops.length;
    let n = 0;
    while (w.map.get(tx, ty) !== T_AIR && n++ < 200) run(w, 1, { 1: { ...EMPTY_INPUT, buttons: BTN_ACTION1, cx: 16, cy: 0 } });
    expect(w.map.get(tx, ty)).toBe(T_AIR);
    expect(a.wood).toBe(0);
    expect(w.drops.length).toBe(before + 1);
    expect(w.drops[before].kind).toBe(0);
    expect(w.drops[before].amount).toBe(8);
    const d = w.drops[before];
    run(w, 30, {});
    a.x = d.x - px(3); a.y = d.y - px(7); a.vx = 0; a.vy = 0;
    run(w, 3, {});
    expect(a.wood).toBe(8);
    expect(w.drops.length).toBe(before);
  });

  it('bomb drops are only picked up by knights, up to the class max', () => {
    const w = setup();
    const a = w.getPlayer(1)!;
    a.cls = 1; a.state = PlayerState.Alive; a.hp = 8; a.vx = 0; a.vy = 0;
    w.spawnDrop(3, 5, a.x + px(3), a.y + px(7), 0, 0);
    run(w, 30, {});
    expect(w.drops.length).toBe(1); // 궁수는 폭탄을 못 줍는다
    a.cls = 0; a.bombs = 0;
    run(w, 3, {});
    expect(a.bombs).toBeGreaterThan(0);
  });
});

describe('map generation', () => {
  it('has no floating trees and no 1-tile bumps on the surface (many seeds)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const w = new World(seed);
      const m = w.map;
      for (let x = 0; x < m.w; x++) {
        for (let y = 0; y < m.h - 1; y++) {
          if (m.get(x, y) === tileId('tree_trunk') && m.get(x, y + 1) !== tileId('tree_trunk')) {
            expect(m.isSolid(x, y + 1), `seed ${seed} tree at ${x},${y} floats`).toBe(true);
          }
        }
      }
      // 표면 높이 = 각 열의 최상단 잔디/흙 (나무 제외)
      const surf = (x: number): number => { for (let y = 0; y < m.h; y++) { const t = m.get(x, y); if (t === tileId('grass') || t === tileId('dirt')) return y; } return m.h; };
      for (let x = 26; x < m.w - 26; x++) {
        const l = surf(x - 1), c = surf(x), r = surf(x + 1);
        if (Math.abs(x - m.w / 2) <= 10) continue; // 호수

        expect(c < l && c < r, `seed ${seed} bump at x=${x}`).toBe(false);
      }
    }
  });
});

describe('vehicles', () => {
  it('spawns one cart per team, mounts with E, drives, climbs 1-tile steps, dismounts', () => {
    const w = setup();
    expect(w.vehicles.length).toBe(2);
    const a = w.getPlayer(1)!;
    a.state = PlayerState.Alive; a.hp = 8;
    const v = w.vehicles.find((v) => v.team === a.team)!;
    // 탈것 옆으로 이동해 E
    a.x = v.x; a.y = v.y - px(14); a.vx = 0; a.vy = 0;
    run(w, 2, {});
    run(w, 1, { 1: { ...EMPTY_INPUT, buttons: BTN_USE } });
    expect(a.vehicle).toBe(v.id);
    expect(v.driver).toBe(a.id);
    // 평평한 활주로를 만들고 1칸 계단 하나를 놓는다
    run(w, 30, {}); // 착지
    const startX = v.x;
    const groundY = (v.y + px(8)) >> 11, x0 = v.x >> 11;
    for (let x = x0 - 2; x < x0 + 40; x++) { for (let y = groundY - 6; y < groundY; y++) w.map.set(x, y, 0); w.map.set(x, groundY, 1); }
    w.map.set(x0 + 12, groundY - 1, 1); w.map.set(x0 + 13, groundY - 1, 1);
    run(w, 90, { 1: { ...EMPTY_INPUT, buttons: 2 /* BTN_RIGHT */ } });
    expect(v.x).toBeGreaterThan(startX + px(100)); // 계단을 넘어 12.5칸 이상 전진
    expect(v.y + px(8)).toBeLessThanOrEqual(groundY << 11);
    expect(a.x).toBeGreaterThan(startX); // 운전자도 같이 이동
    expect(a.hp).toBe(8);
    // 내리기
    run(w, 1, {});
    run(w, 1, { 1: { ...EMPTY_INPUT, buttons: BTN_USE } });
    expect(a.vehicle).toBe(0);
    expect(v.driver).toBe(0);
  });

  it('vehicle takes arrow damage and respawns after destruction', () => {
    const w = setup();
    const v = w.vehicles.find((v) => v.team === 1)!;
    const before = w.vehicles.length;
    v.hp = 1;
    w.projectiles.push({ id: 99, kind: 0, owner: 1, team: 0, x: v.x - px(4), y: v.y + px(4), vx: 600, vy: 0, timer: 100, damage: 2, stuck: false });
    run(w, 3, {});
    expect(w.vehicles.length).toBe(before - 1);
    expect(w.vehicleRespawnAt[1]).toBeGreaterThan(0);
    run(w, 901, {});
    expect(w.vehicles.length).toBe(before);
  });
});

describe('water leveling', () => {
  it('a lopsided fill settles to a horizontal surface (column totals within 2 units)', () => {
    const w = setup();
    const m = w.map;
    // 밀폐된 분지: 폭 24, 깊이 4, 위는 열림
    const x0 = 60, y0 = 20, W = 24, D = 4;
    for (let x = x0 - 1; x <= x0 + W; x++) for (let y = y0 - 8; y <= y0 + D; y++) { m.set(x, y, 0); m.water[y * m.w + x] = 0; }
    for (let x = x0 - 1; x <= x0 + W; x++) m.set(x, y0 + D, 3);
    for (let y = y0 - 8; y <= y0 + D; y++) { m.set(x0 - 1, y, 3); m.set(x0 + W, y, 3); }
    // 왼쪽 절반만 가득 채움
    for (let x = x0; x < x0 + W / 2; x++) for (let y = y0; y < y0 + D; y++) m.water[y * m.w + x] = WATER_MAX;
    const total0 = m.water.reduce((s, v) => s + v, 0);
    run(w, 600, {});
    expect(m.water.reduce((s, v) => s + v, 0)).toBe(total0);
    const col = (x: number) => { let s = 0; for (let y = y0 - 8; y <= y0 + D; y++) s += m.water[y * m.w + x]; return s; };
    let lo = Infinity, hi = -Infinity;
    for (let x = x0; x < x0 + W; x++) { const c = col(x); lo = Math.min(lo, c); hi = Math.max(hi, c); }
    expect(hi - lo).toBeLessThanOrEqual(2);
  });
});

describe('terrain protection rules', () => {
  it('dirt back wall is indestructible even by explosions; bedrock slab lies under the base', () => {
    const w = setup();
    const m = w.map;
    const a = w.getPlayer(1)!;
    const cx = a.x >> 11, gy = (a.y + px(14)) >> 11;
    // 스폰 아래 3칸은 bedrock
    for (let k = 1; k <= 3; k++) expect(m.get(cx, gy + k)).toBe(tileId('bedrock'));
    // 흙 뒷벽은 damageBack 으로도 안 사라짐
    let found = -1;
    for (let i = 0; i < m.w * m.h; i++) if (m.backType[i] === T_DIRT_BACK && m.type[i] === T_AIR) { found = i; break; }
    if (found >= 0) {
      const x = found % m.w, y = (found / m.w) | 0;
      expect(m.damageBack(x, y, 999)).toBe(false);
      expect(m.getBack(x, y)).toBe(T_DIRT_BACK);
    }
  });

  it('water passes through tree trunks and leaves', () => {
    const w = setup();
    const m = w.map;
    const x = 70, y = 10;
    for (let yy = y - 1; yy <= y + 4; yy++) { m.set(x, yy, 0); m.set(x - 1, yy, 3); m.set(x + 1, yy, 3); }
    m.set(x, y + 4, 3);
    m.set(x, y + 1, tileId('tree_trunk')); m.set(x, y + 2, tileId('tree_leaf'));
    m.water[y * m.w + x] = WATER_MAX;
    run(w, 30, {});
    expect(m.water[(y + 3) * m.w + x]).toBe(WATER_MAX);
    expect(m.water[y * m.w + x]).toBe(0);
  });

  it('player can jump out of water onto land when the head is above the surface', () => {
    const w = setup();
    const a = w.getPlayer(1)!;
    a.state = PlayerState.Alive; a.hp = 8;
    const m = w.map;
    // 2칸 깊이 웅덩이, 오른쪽에 지면
    const x0 = 80, gy = 20;
    for (let x = x0 - 3; x <= x0 + 6; x++) for (let y = gy - 8; y <= gy + 3; y++) { m.set(x, y, 0); m.water[y * m.w + x] = 0; }
    for (let x = x0 - 3; x <= x0 + 6; x++) m.set(x, gy + 3, 3);
    for (let x = x0 + 3; x <= x0 + 6; x++) { m.set(x, gy + 1, 3); m.set(x, gy + 2, 3); }
    for (let y = gy - 8; y <= gy + 3; y++) { m.set(x0 + 6, y, 3); m.set(x0 - 3, y, 3); } // 양쪽 벽
    for (let x = x0 - 2; x < x0 + 3; x++) for (let y = gy + 1; y <= gy + 2; y++) m.water[y * m.w + x] = WATER_MAX;
    a.x = (x0 + 1) << 11; a.y = ((gy + 1) << 11) - px(6); a.vx = 0; a.vy = 0;
    run(w, 20, {});
    expect(a.inWater).toBe(true);
    // 점프 + 오른쪽
    run(w, 40, { 1: { ...EMPTY_INPUT, buttons: 16 | 2 } });
    run(w, 30, {});
    expect(a.onGround).toBe(true);
    expect(a.inWater).toBe(false);
    expect(a.y + px(14)).toBeLessThanOrEqual((gy + 1) << 11);
    expect(a.x >> 11).toBeGreaterThanOrEqual(x0 + 3);
  });
});

describe('dev cheats (input-carried, deterministic)', () => {
  it('tp, god, dummy, cart, water, tile, clear, score, respawn', () => {
    const w = setup();
    const a = w.getPlayer(1)!;
    a.state = PlayerState.Alive; a.hp = 8;
    run(w, 1, { 1: { ...EMPTY_INPUT, cheat: 5, a0: 100, a1: 30 } });
    expect(a.x >> 11).toBe(100);
    run(w, 1, { 1: { ...EMPTY_INPUT, cheat: 4 } });
    expect(a.god).toBe(1);
    const hp = a.hp; w.hurt(a, 5, 0, 0, 0); expect(a.hp).toBe(hp);
    const n0 = w.players.length;
    run(w, 1, { 1: { ...EMPTY_INPUT, cheat: 15, a0: -1, a1: 1 } });
    expect(w.players.length).toBe(n0 + 1);
    expect(w.players.find((p) => p.id >= 900)!.team).toBe(1 - a.team);
    run(w, 1, { 1: { ...EMPTY_INPUT, cheat: 19 } });
    expect(w.players.length).toBe(n0);
    const v0 = w.vehicles.length;
    run(w, 1, { 1: { ...EMPTY_INPUT, cheat: 8 } });
    expect(w.vehicles.length).toBe(v0 + 1);
    run(w, 1, { 1: { ...EMPTY_INPUT, cheat: 17, a0: 2, a1: 1 } });
    expect(w.score[0]).toBe(2); expect(w.score[1]).toBe(1);
    // 같은 치트를 연속 틱에 보내면 한 번만 적용 (edge)
    run(w, 3, { 1: { ...EMPTY_INPUT, cheat: 1 } });
    expect(a.wood).toBe(1000);
    // 스냅샷 왕복 후에도 동일
    const buf = serializeWorld(w);
    expect(hashWorld(deserializeWorld(buf))).toBe(hashWorld(w));
  });
});

describe('variable jump', () => {
  it('holding jump goes higher than tapping', () => {
    const jumpHeight = (holdTicks: number): number => {
      const w = setup();
      const a = w.getPlayer(1)!;
      a.state = PlayerState.Alive; a.hp = 8;
      run(w, 5, {});
      const y0 = a.y; let minY = y0;
      for (let t = 0; t < 40; t++) { run(w, 1, t < holdTicks ? { 1: { ...EMPTY_INPUT, buttons: 16 } } : {}); minY = Math.min(minY, a.y); }
      return (y0 - minY) / 256;
    };
    const tap = jumpHeight(1), hold = jumpHeight(20);
    expect(tap).toBeGreaterThan(15);
    expect(hold).toBeGreaterThan(tap * 1.6);
    expect(hold).toBeLessThan(80);
  });
});
