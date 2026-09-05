/**
 * [DEV] 치트 콘솔. 기본 비활성(키 하나로 발동되는 치트 없음). ` 키로 프롬프트를 열고 명령을 입력한다.
 *   /cheat        치트 목록
 *   /res          자원 +1000            → 입력 cheat=1 로 전송 (P2P 동기화)
 *   /dig          타일 즉사 토글        → 입력 cheat=2
 *   /heal         체력 회복             → 입력 cheat=3
 * 릴리즈 시: main.ts 의 `import { runCheat } from './dev/cheats'` 줄과 호출부를 주석 처리하고
 * world.ts 의 CHEATS_ENABLED 를 false 로 바꾼다.
 */
export interface CheatSink {
  log: (s: string) => void;
  request: (code: number) => void; // 다음 틱 입력에 실을 치트 코드
}

const LIST = [
  '/cheat  - list cheats',
  '/res    - +1000 wood/stone/gold',
  '/dig    - toggle instant dig',
  '/heal   - full heal',
];

export function runCheat(text: string, sink: CheatSink): boolean {
  const cmd = text.trim().toLowerCase().split(/\s+/)[0];
  switch (cmd) {
    case '/cheat': case '/help': for (const l of LIST) sink.log(l); return true;
    case '/res': sink.request(1); sink.log('[cheat] +1000 resources'); return true;
    case '/dig': sink.request(2); sink.log('[cheat] instant dig toggled'); return true;
    case '/heal': sink.request(3); sink.log('[cheat] heal'); return true;
    default: return false;
  }
}
