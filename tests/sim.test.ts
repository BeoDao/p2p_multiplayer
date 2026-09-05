import { describe, it, expect } from 'vitest';
import { bsin, bcos, batan2, isqrt, SIN_ONE } from '../src/sim/fixed';
import { World, type TickFrame } from '../src/sim/world';
import { serializeWorld, deserializeWorld, hashWorld } from '../src/sim/serialize';
import { BTN_RIGHT, BTN_JUMP, BTN_ACTION1, BTN_LEFT, type Input } from '../src/sim/input';
import { Rng } from '../src/sim/rng';

describe('fixed math', () => {
  it('sin/cos table matches float within 1 LSB', () => {
    for (let a = 0; a < 4096; a += 7) {
      const rad = (a / 4096) * Math.PI * 2;
      expect(Math.abs(bsin(a) - Math.round(Math.sin(rad) * SIN_ONE))).toBeLessThanOrEqual(1);
      expect(Math.abs(bcos(a) - Math.round(Math.cos(rad) * SIN_ONE))).toBeLessThanOrEqual(1);
    }
  });
  it('atan2 close to float', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 500; i++) {
      const x = rng.range(-1000, 1000), y = rng.range(-1000, 1000);
      if (x === 0 && y === 0) continue;
      const f = ((Math.atan2(y, x) / (Math.PI * 2)) * 4096 + 4096) % 4096;
      const d = Math.abs(batan2(y, x) - f);
      expect(Math.min(d, 4096 - d)).toBeLessThanOrEqual(2);
    }
  });
  it('isqrt exact', () => {
    for (let n = 0; n < 5000; n++) expect(isqrt(n)).toBe(Math.floor(Math.sqrt(n)));
    expect(isqrt(2 ** 40 + 12345)).toBe(Math.floor(Math.sqrt(2 ** 40 + 12345)));
  });
});

function scriptedFrame(tick: number, pids: number[]): TickFrame {
  const inputs = new Map<number, Input>();
  for (const pid of pids) {
    const phase = (tick + pid * 37) % 120;
    let buttons = 0;
    if (phase < 50) buttons |= BTN_RIGHT; else if (phase < 90) buttons |= BTN_LEFT;
    if (phase % 23 === 0) buttons |= BTN_JUMP;
    if (phase % 17 < 8) buttons |= BTN_ACTION1;
    inputs.set(pid, { buttons, cx: ((tick * 7 + pid) % 60) - 30, cy: ((tick * 3) % 40) - 20, slot: (tick / 200 | 0) % 3, cls: tick % 400 === 0 ? pid % 3 : 3 });
  }
  return { inputs, joins: [], leaves: [] };
}

describe('world determinism', () => {
  it('two worlds with same seed+inputs produce identical hashes', () => {
    const a = new World(1234), b = new World(1234);
    for (const w of [a, b]) w.step({ inputs: new Map(), joins: [{ pid: 1, name: 'a', team: 0 }, { pid: 2, name: 'b', team: 1 }, { pid: 3, name: 'c', team: 2 }], leaves: [] });
    for (let t = 1; t < 1500; t++) {
      a.step(scriptedFrame(t, [1, 2, 3]));
      b.step(scriptedFrame(t, [1, 2, 3]));
    }
    expect(hashWorld(a)).toBe(hashWorld(b));
    expect(a.players.length).toBe(3);
  });
  it('snapshot roundtrip continues identically', () => {
    const a = new World(99);
    a.step({ inputs: new Map(), joins: [{ pid: 1, name: 'a', team: 0 }, { pid: 2, name: 'b', team: 1 }], leaves: [] });
    for (let t = 1; t < 600; t++) a.step(scriptedFrame(t, [1, 2]));
    const snap = serializeWorld(a);
    const b = deserializeWorld(snap);
    expect(hashWorld(b)).toBe(hashWorld(a));
    for (let t = 600; t < 1200; t++) { a.step(scriptedFrame(t, [1, 2])); b.step(scriptedFrame(t, [1, 2])); }
    expect(hashWorld(b)).toBe(hashWorld(a));
  });
  it('players spawn on ground and move', () => {
    const w = new World(7);
    w.step({ inputs: new Map(), joins: [{ pid: 1, name: 'a', team: 0 }], leaves: [] });
    for (let t = 0; t < 5; t++) w.step({ inputs: new Map(), joins: [], leaves: [] });
    const p = w.players[0];
    const x0 = p.x;
    for (let t = 0; t < 30; t++) w.step({ inputs: new Map([[1, { buttons: BTN_RIGHT, cx: 10, cy: 0, slot: 0, cls: 3 }]]), joins: [], leaves: [] });
    expect(p.x).toBeGreaterThan(x0);
    expect(p.state).toBe(1);
  });
});
