import { describe, it, expect } from 'vitest';
import { World, type TickFrame } from '../src/sim/world';
import { EMPTY_INPUT, type Input } from '../src/sim/input';
import { Rng } from '../src/sim/rng';
import { hashWorld, serializeWorld, deserializeWorld } from '../src/sim/serialize';
import { ReplayRecorder, parseReplay, replayWorld } from '../src/net/replay';

function randomFrame(rng: Rng, pids: number[]): TickFrame {
  const inputs = new Map<number, Input>();
  for (const pid of pids) inputs.set(pid, { ...EMPTY_INPUT, buttons: rng.int(256), cx: rng.range(-60, 60), cy: rng.range(-60, 60), slot: rng.int(4) });
  return { inputs, joins: [], leaves: [] };
}

describe('replay', () => {
  it('records from tick 0 and replays to identical hashes (with joins/leaves)', () => {
    const w = new World(99);
    const rec = new ReplayRecorder();
    rec.start(w, 'ROOM');
    const rng = new Rng(5);
    const pids: number[] = [];
    for (let t = 0; t < 700; t++) {
      const f = randomFrame(rng, pids);
      if (t === 0) { f.joins.push({ pid: 1, name: 'a', team: 0 }, { pid: 2, name: 'b', team: 1 }); pids.push(1, 2); }
      if (t === 300) { f.joins.push({ pid: 3, name: 'c', team: -1 }); pids.push(3); }
      if (t === 500) { f.leaves.push(2); pids.splice(pids.indexOf(2), 1); }
      rec.record(w, f);
      w.step(f);
      if (w.tick % 60 === 0) rec.recordHash(w.tick, hashWorld(w));
    }
    const bytes = rec.export();
    expect(bytes.length).toBeGreaterThan(700 * 10);
    const rep = parseReplay(bytes);
    expect(rep.seed).toBe(99); expect(rep.startTick).toBe(0); expect(rep.frames.size).toBe(700);
    const w2 = replayWorld(rep, (seed) => new World(seed));
    let checked = 0;
    for (let t = 0; t < rep.endTick; t++) {
      const f = rep.frames.get(t) ?? { inputs: new Map(), joins: [], leaves: [] };
      w2.step(f);
      const h = rep.hashes.get(w2.tick);
      if (h !== undefined) { expect(hashWorld(w2), `hash at ${w2.tick}`).toBe(h); checked++; }
    }
    expect(checked).toBeGreaterThan(5);
    expect(hashWorld(w2)).toBe(hashWorld(w));
  });

  it('records from a mid-game snapshot (late joiner) and replays', () => {
    const w = new World(3);
    w.step({ inputs: new Map(), joins: [{ pid: 1, name: 'a', team: 0 }], leaves: [] });
    const rng = new Rng(9);
    for (let t = 0; t < 200; t++) w.step(randomFrame(rng, [1]));
    // 스냅샷으로 복원한 월드에서 기록 시작 (참가자 관점)
    const w1 = deserializeWorld(serializeWorld(w));
    const rec = new ReplayRecorder();
    rec.start(w1, 'R');
    for (let t = 0; t < 150; t++) { const f = randomFrame(rng, [1]); rec.record(w1, f); w1.step(f); if (w1.tick % 60 === 0) rec.recordHash(w1.tick, hashWorld(w1)); }
    const rep = parseReplay(rec.export());
    expect(rep.startTick).toBe(201);
    expect(rep.snapshot).not.toBeNull();
    const w2 = replayWorld(rep, (seed) => new World(seed));
    for (let t = rep.startTick; t < rep.endTick; t++) w2.step(rep.frames.get(t)!);
    expect(hashWorld(w2)).toBe(hashWorld(w1));
  });
});

describe('replay integrity', () => {
  it('rejects a modified or truncated file', () => {
    const w = new World(1);
    const rec = new ReplayRecorder();
    rec.start(w, 'X');
    for (let t = 0; t < 30; t++) { const f = { inputs: new Map(), joins: [] as never[], leaves: [] as number[] }; rec.record(w, f); w.step(f); }
    const ok = rec.export();
    expect(() => parseReplay(ok)).not.toThrow();
    const tampered = ok.slice(); tampered[ok.length - 20] ^= 0x55; // 입력 바이트 하나 변경
    expect(() => parseReplay(tampered)).toThrow(/modified/);
    expect(() => parseReplay(ok.slice(0, ok.length - 3))).toThrow();
  });
});
