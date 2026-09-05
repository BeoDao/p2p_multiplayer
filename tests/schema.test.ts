import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { PlayerState } from '../src/sim/types';
import { EMPTY_INPUT } from '../src/sim/input';
import { schemaKeys } from '../src/sim/schema';
import { PLAYER_SCHEMA, PROJECTILE_SCHEMA, FLAG_SCHEMA, DROP_SCHEMA, VEHICLE_SCHEMA, INPUT_SCHEMA, WORLD_SCALARS, WORLD_COLLECTIONS, serializeWorld, deserializeWorld, hashWorld } from '../src/sim/serialize';

/** 실제 객체의 키 집합과 스키마 키 집합이 정확히 같아야 한다 — 필드 추가 후 직렬화를 빠뜨리면 여기서 걸린다 */
function expectSameKeys(name: string, obj: object, keys: string[]): void {
  const have = Object.keys(obj).sort(), want = [...keys].sort();
  expect(have, `${name}: object keys vs schema`).toEqual(want);
}

describe('serialization schema covers every field', () => {
  it('player / input / projectile / flag / drop / vehicle / world scalars', () => {
    const w = new World(7);
    w.step({ inputs: new Map(), joins: [{ pid: 1, name: 'a', team: 0 }], leaves: [] });
    const p = w.getPlayer(1)!;
    p.state = PlayerState.Alive;
    // 투사체/드롭은 시뮬로 만들어 본다
    w.projectiles.push({ id: 1, kind: 0, owner: 1, team: 0, x: 0, y: 0, vx: 0, vy: 0, timer: 1, damage: 1, stuck: false, attach: 0 });
    w.spawnDrop(0, 1, p.x, p.y, 0, 0);
    expectSameKeys('player', p, schemaKeys(PLAYER_SCHEMA));
    expectSameKeys('input', { ...EMPTY_INPUT }, schemaKeys(INPUT_SCHEMA));
    expectSameKeys('projectile', w.projectiles[0], schemaKeys(PROJECTILE_SCHEMA));
    expectSameKeys('flag', w.flags[0], schemaKeys(FLAG_SCHEMA));
    expectSameKeys('drop', w.drops[0], schemaKeys(DROP_SCHEMA));
    expectSameKeys('vehicle', w.vehicles[0], schemaKeys(VEHICLE_SCHEMA));
    // World 자체: 스칼라 + 컬렉션 목록이 인스턴스 필드 전부를 덮어야 한다
    const worldKeys = Object.keys(w).sort();
    const covered = [...schemaKeys(WORLD_SCALARS), ...WORLD_COLLECTIONS].sort();
    expect(worldKeys).toEqual(covered);
  });

  it('roundtrip preserves hash and every field value', () => {
    const w = new World(11);
    w.step({ inputs: new Map(), joins: [{ pid: 1, name: 'a', team: 0 }, { pid: 2, name: 'b', team: 1 }], leaves: [] });
    for (let i = 0; i < 40; i++) w.step({ inputs: new Map([[1, { ...EMPTY_INPUT, buttons: 2 | 16 }]]), joins: [], leaves: [] });
    const buf = serializeWorld(w);
    const w2 = deserializeWorld(buf);
    expect(hashWorld(w2)).toBe(hashWorld(w));
    expect(w2.players).toEqual(w.players);
    expect(w2.vehicles).toEqual(w.vehicles);
    expect(w2.flags).toEqual(w.flags);
    // 이후 진행도 동일
    for (let i = 0; i < 30; i++) { const f = { inputs: new Map([[1, { ...EMPTY_INPUT, buttons: 1 }]]), joins: [], leaves: [] }; w.step(f); w2.step({ ...f, inputs: new Map(f.inputs) }); }
    expect(hashWorld(w2)).toBe(hashWorld(w));
  });
});
