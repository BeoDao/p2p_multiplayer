import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import { CLASSES } from '../src/data/defs';
import { PlayerState } from '../src/sim/types';
import { px, toTile } from '../src/sim/fixed';
import type { Input } from '../src/sim/input';

/** 무작위 입력으로 오래 돌리며 불변식 검사: 타일 안에 끼임, 음수 자원, 범위 밖 체력, NaN 등 */
describe('fuzz invariants', () => {
  it('random play keeps invariants for 4 players over 6000 ticks', () => {
    const rng = new Rng(777);
    const w = new World(2024);
    w.step({ inputs: new Map(), joins: [1, 2, 3, 4].map((pid) => ({ pid, name: 'p' + pid, team: -1 })), leaves: [] });
    // 전투가 실제로 일어나도록 전원을 같은 지점에 모아 시작
    for (let i = 0; i < 6; i++) w.step({ inputs: new Map(), joins: [], leaves: [] });
    const a0 = w.players[0];
    for (const p of w.players) { p.x = a0.x + px(12) * (p.id - 1); p.y = a0.y; p.vx = 0; p.vy = 0; }
    const held = new Map<number, Input>();
    const events: Record<string, number> = {};
    for (let t = 0; t < 6000; t++) {
      const inputs = new Map<number, Input>();
      for (const p of w.players) {
        let inp = held.get(p.id);
        if (!inp || rng.int(8) === 0) {
          inp = { buttons: rng.int(256), cx: rng.range(-60, 60), cy: rng.range(-60, 60), slot: rng.int(9), cls: rng.int(40) === 0 ? rng.int(3) : 3 };
          held.set(p.id, inp);
        }
        inputs.set(p.id, inp);
        // 가끔 자원 지급 → 건설도 일어나게
        if (rng.int(200) === 0) { p.wood += 50; p.stone += 50; }
      }
      w.step({ inputs, joins: [], leaves: [] });
      for (const e of w.events) events[e.kind] = (events[e.kind] ?? 0) + 1;
      for (const p of w.players) {
        const cls = CLASSES[p.cls];
        expect(Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.vx) && Number.isInteger(p.vy), `tick ${t} ints`).toBe(true);
        expect(p.hp).toBeGreaterThanOrEqual(0);
        expect(p.hp).toBeLessThanOrEqual(cls.hp);
        expect(p.wood).toBeGreaterThanOrEqual(0); expect(p.stone).toBeGreaterThanOrEqual(0); expect(p.gold).toBeGreaterThanOrEqual(0);
        expect(p.bombs).toBeGreaterThanOrEqual(0); expect(p.arrows).toBeGreaterThanOrEqual(0);
        if (p.state === PlayerState.Alive) {
          // 고체 타일 안에 있으면 안 됨
          const w0 = px(cls.width), h0 = px(cls.height);
          const x0 = toTile(p.x), x1 = toTile(p.x + w0 - 1), y0 = toTile(p.y), y1 = toTile(p.y + h0 - 1);
          let inside = false;
          for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (w.map.solidFor(tx, ty, p.team)) inside = true;
          expect(inside, `tick ${t} player ${p.id} inside solid at ${x0},${y0}`).toBe(false);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x + w0).toBeLessThanOrEqual(w.map.w * 2048);
        }
      }
      expect(w.projectiles.length).toBeLessThan(500);
      for (const f of w.flags) expect(f.carrier === 0 || w.getPlayer(f.carrier)?.carryingFlag === f.team, `tick ${t} flag carrier consistency`).toBe(true);
    }
    // 뭔가는 일어났어야 함
    const kills = w.players.reduce((s, p) => s + p.kills, 0);
    const deaths = w.players.reduce((s, p) => s + p.deaths, 0);
    expect((events.hit ?? 0) + (events.explode ?? 0) + deaths).toBeGreaterThan(0);
    expect(events.build ?? 0).toBeGreaterThan(0);
    void kills;
  }, 30000);
});
