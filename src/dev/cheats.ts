/**
 * [DEV] 치트 콘솔. 기본 비활성(키 하나로 발동되는 치트 없음). ` 키로 프롬프트를 열고 명령을 입력한다.
 * 명령은 입력(cheat 코드 + 인자 2개)에 실려 P2P 로 전송되므로 모든 피어에서 같은 틱에 똑같이 적용된다.
 * 코드 표는 world.ts applyCheat 와 일치해야 한다.
 * 릴리즈 시: main.ts 의 `import { runCheat } from './dev/cheats'` 줄과 호출부를 주석 처리하고
 * world.ts 의 CHEATS_ENABLED 를 false 로 바꾼다.
 */
import { CLASSES, TILE_TABLE } from '../data/defs';

export interface CheatSink {
  log: (s: string) => void;
  request: (code: number, a0?: number, a1?: number) => void; // 다음 틱 입력에 실을 치트 코드/인자
}

const LIST = [
  '/cheat                 list cheats',
  '/res                   +1000 wood/stone/gold',
  '/dig                   toggle instant dig',
  '/heal                  full heal',
  '/god                   toggle invincibility',
  '/tp <x> <y>            teleport to tile (or /tp base | /tp enemy | /tp mid)',
  '/cls knight|archer|builder   change class anywhere',
  '/ammo [n]              +bombs/+arrows (default 10/30)',
  '/cart                  spawn a cart at your position',
  '/kill                  die',
  '/flag                  take the enemy flag',
  '/water [r]             fill water around the cursor (radius r, default 2)',
  '/tile <name> [back]    place a tile at the cursor (e.g. /tile stone_block, /tile stone_back back)',
  '/clear [r]             remove tiles around you (radius r, default 4)',
  '/win                   end the round with your team winning',
  '/dummy [team] [class]  spawn a dummy bot at the cursor (default: enemy knight)',
  '/nodummy               remove all dummies',
  '/drop <kind> [n]       drop item: wood|stone|gold|bombs|arrows',
  '/score <a> <b>         set score',
  '/respawn               respawn now (when dead)',
  '/skip [ticks]          advance water simulation quickly',
];

const CLASS_BY_NAME: Record<string, number> = {};
for (const c of CLASSES) CLASS_BY_NAME[c.name] = c.id;
const DROP_KINDS: Record<string, number> = { wood: 0, stone: 1, gold: 2, bombs: 3, bomb: 3, arrows: 4, arrow: 4 };

function num(s: string | undefined, def = 0): number { const v = parseInt(s ?? '', 10); return Number.isFinite(v) ? v : def; }

export function runCheat(text: string, sink: CheatSink, ctx?: { spawnX: number[]; mapW: number; team: number; groundY: (tx: number) => number }): boolean {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const ok = (msg: string) => { sink.log('[cheat] ' + msg); return true; };
  switch (cmd) {
    case '/cheat': case '/help': for (const l of LIST) sink.log(l); return true;
    case '/res': sink.request(1); return ok('+1000 resources');
    case '/dig': sink.request(2); return ok('instant dig toggled');
    case '/heal': sink.request(3); return ok('heal');
    case '/god': sink.request(4); return ok('god mode toggled');
    case '/tp': {
      let x = num(parts[1], -1), y = num(parts[2], -1);
      if (ctx && parts[1] && !/^\d/.test(parts[1])) {
        const where = parts[1].toLowerCase();
        x = where === 'base' ? ctx.spawnX[ctx.team] : where === 'enemy' ? ctx.spawnX[1 - ctx.team] : where === 'mid' ? ctx.mapW >> 1 : -1;
        if (x >= 0) y = ctx.groundY(x);
      }
      if (x < 0 || y < 0) return ok('usage: /tp <x> <y> | base | enemy | mid');
      sink.request(5, x, y); return ok(`teleport ${x},${y}`);
    }
    case '/cls': {
      const id = CLASS_BY_NAME[(parts[1] ?? '').toLowerCase()];
      if (id === undefined) return ok('usage: /cls ' + Object.keys(CLASS_BY_NAME).join('|'));
      sink.request(6, id); return ok('class ' + parts[1]);
    }
    case '/ammo': sink.request(7, num(parts[1], 0)); return ok('ammo');
    case '/cart': sink.request(8, 0); return ok('cart spawned');
    case '/kill': sink.request(9); return ok('kill');
    case '/flag': sink.request(10); return ok('enemy flag taken');
    case '/water': sink.request(11, num(parts[1], 2)); return ok('water');
    case '/tile': {
      const name = (parts[1] ?? '').toLowerCase();
      const id = TILE_TABLE.findIndex((t) => t && t.name === name);
      if (id <= 0) return ok('usage: /tile <' + TILE_TABLE.filter((t) => t && t.hp > 0).map((t) => t.name).join('|') + '> [back]');
      sink.request(12, id, parts[2] === 'back' ? 1 : 0); return ok('tile ' + name);
    }
    case '/clear': sink.request(13, num(parts[1], 4)); return ok('cleared');
    case '/win': sink.request(14); return ok('round won');
    case '/dummy': {
      const team = parts[1] === undefined ? -1 : parts[1] === 'blue' ? 0 : parts[1] === 'red' ? 1 : num(parts[1], -1);
      const cls = CLASS_BY_NAME[(parts[2] ?? '').toLowerCase()] ?? 0;
      sink.request(15, team, cls); return ok('dummy spawned');
    }
    case '/nodummy': sink.request(19); return ok('dummies removed');
    case '/drop': {
      const kind = DROP_KINDS[(parts[1] ?? '').toLowerCase()];
      if (kind === undefined) return ok('usage: /drop wood|stone|gold|bombs|arrows [n]');
      sink.request(16, kind, num(parts[2], 10)); return ok('drop');
    }
    case '/score': sink.request(17, num(parts[1], 0), num(parts[2], 0)); return ok('score set');
    case '/respawn': sink.request(18); return ok('respawn');
    case '/skip': sink.request(20, num(parts[1], 300)); return ok('water skipped');
    default: return false;
  }
}
