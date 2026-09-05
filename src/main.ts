/**
 * 엔트리: 메뉴 → 세션 생성(P2P 또는 오프라인) → 게임 루프(입력 수집, 세션 갱신, 렌더).
 */
import { Application } from 'pixi.js';
import { Session, MAX_PLAYERS, type SessionStatus } from './net/session';
import { parseReplay, replayWorld, replayFileName, type Replay } from './net/replay';
import { hashWorld } from './sim/serialize';
import { startBackgroundTicker } from './net/ticker';
import { TrysteroTransport, p2pOptionsFromUrl } from './net/p2p';
import { LocalTransport, type Transport } from './net/transport';
import { Renderer } from './render/renderer';
import { TextureRegistry } from './render/textures';
import { Hud } from './render/hud';
import { Sound } from './render/sound';
import { t, detectLang, setLang, langButtonsHtml, type Lang } from './render/i18n';
import { BTN_LEFT, BTN_RIGHT, BTN_UP, BTN_DOWN, BTN_JUMP, BTN_ACTION1, BTN_ACTION2, BTN_USE, type Input } from './sim/input';
import { CLASSES } from './data/defs';
import { FP_ONE } from './sim/fixed';
import { PlayerState, TICK_RATE } from './sim/types';
import { CHEATS_ENABLED, World } from './sim/world';
import { runCheat } from './dev/cheats'; // [DEV] 릴리즈 시 주석 처리

const TICK_MS = 1000 / TICK_RATE;

function randomRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[(Math.random() * chars.length) | 0];
  return s;
}

function showMenu(): Promise<{ name: string; room: string; offline: boolean; replay?: Uint8Array }> {
  return new Promise((resolve) => {
    const hashRoom = location.hash.replace('#', '').toUpperCase();
    const savedName = localStorage.getItem('rw.name') ?? '';
    const el = document.createElement('div');
    el.className = 'menu';
    el.innerHTML = `
      <div class="panel">
        <div class="langs">${langButtonsHtml()}</div>
        <h1 translate="no">Rubblewar</h1>
        <p class="sub">${t('subtitle')}</p>
        <label>${t('name')}</label>
        <input id="m-name" maxlength="12" value="${savedName.replace(/"/g, '')}" placeholder="${t('namePlaceholder')}" translate="no">
        <label>${t('room')}</label>
        <input id="m-room" maxlength="16" value="${hashRoom || randomRoomCode()}" style="text-transform:uppercase" translate="no">
        <div class="row">
          <button id="m-join">${t('join')}</button>
          <button id="m-offline" class="secondary">${t('offline')}</button>
        </div>
        <div class="row small-row">
          <button id="m-replay" class="secondary small">${t('loadReplay')}</button>
          <input id="m-replay-file" type="file" accept=".rwr" hidden>
        </div>
        <div class="help">
          ${t('help1')}<br>
          ${t('help2')}<br>
          ${t('help3')}<br>
          ${t('help4')}
        </div>
      </div>`;
    document.body.appendChild(el);
    const nameEl = el.querySelector<HTMLInputElement>('#m-name')!;
    const roomEl = el.querySelector<HTMLInputElement>('#m-room')!;
    const go = (offline: boolean) => {
      const name = (nameEl.value.trim() || 'Player' + ((Math.random() * 90 + 10) | 0)).slice(0, 12);
      const room = (roomEl.value.trim().toUpperCase() || randomRoomCode()).slice(0, 16);
      localStorage.setItem('rw.name', name);
      if (!offline) location.hash = room;
      el.remove();
      resolve({ name, room, offline });
    };
    el.querySelectorAll<HTMLButtonElement>('.langs button').forEach((b) => b.addEventListener('click', () => { setLang(b.dataset.lang as Lang); el.remove(); void showMenu().then(resolve); }));
    el.querySelector('#m-join')!.addEventListener('click', () => go(false));
    const fileEl = el.querySelector<HTMLInputElement>('#m-replay-file')!;
    el.querySelector('#m-replay')!.addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', async () => {
      const f = fileEl.files?.[0]; if (!f) return;
      const bytes = new Uint8Array(await f.arrayBuffer());
      el.remove();
      resolve({ name: 'replay', room: '', offline: true, replay: bytes });
    });
    el.querySelector('#m-offline')!.addEventListener('click', () => go(true));
    nameEl.focus();
    roomEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(false); });
  });
}

class InputState {
  keys = new Set<string>();
  mouseX = 0; mouseY = 0;
  mouseDown = new Set<number>();
  /** 틱 사이에 눌렀다 뗀 입력을 놓치지 않도록 래치 */
  latched = new Set<string>();
  slot = 0;
  clsRequest = 3;
  cheatRequest = 0; cheatA0 = 0; cheatA1 = 0;
  /** 채팅 입력 중이면 게임 키 무시 */
  blocked = false;
  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || this.blocked) return;
      this.keys.add(e.code);
      this.latched.add(e.code);
      if (e.code.startsWith('Digit')) { const n = parseInt(e.code.slice(5), 10); if (n >= 1 && n <= 9) this.slot = n - 1; }
      if (e.code === 'F1') { this.clsRequest = 0; e.preventDefault(); }
      if (e.code === 'F2') { this.clsRequest = 1; e.preventDefault(); }
      if (e.code === 'F3') { this.clsRequest = 2; e.preventDefault(); }
      if (e.code === 'Tab') e.preventDefault();
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown.clear(); });
    canvas.addEventListener('mousemove', (e) => { this.mouseX = e.clientX; this.mouseY = e.clientY; });
    canvas.addEventListener('mousedown', (e) => { this.mouseDown.add(e.button); this.latched.add('Mouse' + e.button); e.preventDefault(); });
    window.addEventListener('mouseup', (e) => this.mouseDown.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.slot = Math.max(0, Math.min(15, this.slot + (e.deltaY > 0 ? 1 : -1))); e.preventDefault(); }, { passive: false });
  }
  key(...codes: string[]): boolean { return codes.some((c) => this.keys.has(c) || this.latched.has(c)); }
  mouse(b: number): boolean { return this.mouseDown.has(b) || this.latched.has('Mouse' + b); }
  /** 입력이 실제로 틱에 실렸을 때 호출 */
  consumed(): void { this.latched.clear(); this.clsRequest = 3; this.cheatRequest = 0; this.cheatA0 = 0; this.cheatA1 = 0; }
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * 리플레이 재생: 파일의 프레임을 30Hz 로 돌리며 기록된 해시와 비교한다.
 * 조작: Space 일시정지, ←/→ 한 틱, ↑/↓ 속도, [ ] 관전 대상 변경, Esc 메뉴로
 */
function runReplay(bytes: Uint8Array, app: Application, renderer: Renderer, hud: Hud): void {
  let rep: Replay;
  try { rep = parseReplay(bytes); } catch (e) { alert(String(e)); location.reload(); return; }
  const world = replayWorld(rep, (seed) => new World(seed));
  (window as unknown as { __replay: unknown }).__replay = { world, rep, stats: () => ({ verified, mismatchAt }) };
  // 효과음: 게임과 동일 (첫 키/클릭에서 오디오 잠금 해제, 관전 대상 위치 기준)
  const sound = new Sound();
  sound.setVolume(Number(localStorage.getItem('rw.vol') ?? '50') / 100);
  const unlock = () => sound.unlock();
  window.addEventListener('keydown', unlock);
  window.addEventListener('mousedown', unlock);
  renderer.eventSink = (e) => sound.onEvent(e);
  let tick = world.tick;
  let paused = false, speed = 1, acc = 0, followIdx = 0;
  let verified = 0, mismatchAt = -1;
  let lastFrame = performance.now(), lastStepAt = performance.now();
  renderer.attachWorld(world);
  const stepOne = (): void => {
    if (world.tick >= rep.endTick) return;
    const f = rep.frames.get(world.tick) ?? { inputs: new Map(), joins: [], leaves: [] };
    world.step(f);
    const h = rep.hashes.get(world.tick);
    if (h !== undefined) { if (hashWorld(world) === h) verified++; else if (mismatchAt < 0) mismatchAt = world.tick; }
    tick = world.tick;
    lastStepAt = performance.now();
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { paused = !paused; e.preventDefault(); }
    else if (e.code === 'ArrowRight') { paused = true; stepOne(); }
    else if (e.code === 'ArrowUp') speed = Math.min(8, speed * 2);
    else if (e.code === 'ArrowDown') speed = Math.max(0.25, speed / 2);
    else if (e.code === 'BracketRight') followIdx++;
    else if (e.code === 'BracketLeft') followIdx--;
    else if (e.code === 'Escape') location.reload();
  });
  // 스텝은 워커 타이머로 (탭이 가려져도 진행), 렌더링만 rAF
  let lastStepClock = performance.now();
  startBackgroundTicker(16, () => {
    const now = performance.now();
    const dt = Math.min(200, now - lastStepClock);
    lastStepClock = now;
    if (paused) return;
    acc += dt * speed;
    let n = 0;
    while (acc >= TICK_MS && n < 8) { acc -= TICK_MS; stepOne(); n++; }
    if (acc > TICK_MS * 4) acc = TICK_MS * 4;
  });
  app.ticker.add(() => {
    const now = performance.now();
    const dtMs = Math.min(100, now - lastFrame);
    lastFrame = now;
    const ps = world.players;
    const follow = ps.length ? ps[((followIdx % ps.length) + ps.length) % ps.length].id : 0;
    const fp = world.getPlayer(follow);
    if (fp) { sound.listenerX = fp.x / FP_ONE; sound.listenerY = fp.y / FP_ONE; }
    const alpha = paused ? 1 : Math.min(1, (now - lastStepAt) / (TICK_MS / speed));
    renderer.update(world, alpha, dtMs / TICK_MS, follow, app.screen.width, app.screen.height);
    const status = mismatchAt >= 0 ? `MISMATCH @${mismatchAt}` : `verified ${verified}`;
    const st: SessionStatus = {
      phase: 'playing', pid: follow, tick, members: ps.length, coordinator: false, stalledMs: 0, desyncs: 0,
      message: `REPLAY ${tick}/${rep.endTick} ×${speed}${paused ? ' ⏸' : ''} · ${status} · Space ←→ ↑↓ [ ] Esc`,
      peers: 0, relays: null, elapsedMs: 0, room: rep.room, offline: true, maxPlayers: MAX_PLAYERS,
    };
    hud.update(world, follow, st, false, false);
  });
}

async function main(): Promise<void> {
  setLang(detectLang());
  const { name, room, offline, replay } = await showMenu();
  const container = document.getElementById('game')!;
  const app = new Application();
  await app.init({ resizeTo: window, antialias: false, roundPixels: true, background: 0x6fa8dc, preference: 'webgl' });
  container.appendChild(app.canvas);
  const tex = new TextureRegistry();
  await tex.load();
  const renderer = new Renderer(app, tex);
  (window as unknown as { __app: unknown; __renderer: unknown }).__app = app;
  (window as unknown as { __app: unknown; __renderer: unknown }).__renderer = renderer;
  const hud = new Hud(container);
  (window as unknown as { __hud: unknown }).__hud = hud;
  if (replay) { runReplay(replay, app, renderer, hud); return; }
  const input = new InputState(app.canvas);
  const sound = new Sound();
  // 설정 (localStorage)
  const volEl = hud.settingsEl.querySelector<HTMLInputElement>('.set-vol')!;
  const zoomEl = hud.settingsEl.querySelector<HTMLSelectElement>('.set-zoom')!;
  const savedVol = Number(localStorage.getItem('rw.vol') ?? '50');
  const savedZoom = Number(localStorage.getItem('rw.zoom') ?? '3');
  volEl.value = String(savedVol); sound.setVolume(savedVol / 100);
  zoomEl.value = String(savedZoom); renderer.zoom = savedZoom;
  volEl.addEventListener('input', () => { sound.setVolume(Number(volEl.value) / 100); localStorage.setItem('rw.vol', volEl.value); });
  zoomEl.addEventListener('change', () => { renderer.zoom = Number(zoomEl.value); localStorage.setItem('rw.zoom', zoomEl.value); });
  const unlock = () => sound.unlock();
  window.addEventListener('keydown', unlock);
  window.addEventListener('mousedown', unlock);
  renderer.eventSink = (e) => {
    sound.onEvent(e);
    if (e.kind === 'die' && session.world) {
      const v = session.world.getPlayer(e.player ?? 0);
      const k = e.by ? session.world.getPlayer(e.by) : undefined;
      const col = (q: { team: number } | undefined) => (q?.team === 0 ? 'blue' : 'red');
      if (v) hud.pushFeed(k && k !== v ? `<span class="${col(k)}" translate="no">${k.name}</span> ⚔ <span class="${col(v)}" translate="no">${v.name}</span>` : t('died', { name: `<span class="${col(v)}" translate="no">${v.name}</span>` }));
    }
    if (e.kind === 'capture' && session.world) { const q = session.world.getPlayer(e.player ?? 0); if (q) hud.pushFeed(t('flagTaken', { name: `<span class="${q.team === 0 ? 'blue' : 'red'}" translate="no">${q.name}</span>` })); }
  };

  const transport: Transport = offline ? new LocalTransport() : new TrysteroTransport(room, p2pOptionsFromUrl());
  (window as unknown as { __transport: unknown }).__transport = transport;
  const session = new Session(transport, name, room, (s) => { console.log('[net]', s); hud.pushLog(s); });
  session.onChat = (pid, who, text) => { const q = session.world?.getPlayer(pid); hud.pushChat(who, text, q?.team ?? -1); };
  // 디싱크 감지 시 리플레이 자동 저장 (개발용 — 릴리즈에서는 CHEATS_ENABLED 와 함께 끈다)
  if (CHEATS_ENABLED) session.onDesync = (bytes) => { downloadBytes(bytes, replayFileName(room)); hud.pushLog('[dev] desync replay saved'); };
  // 채팅/설정 키 (게임 입력보다 먼저 처리)
  window.addEventListener('keydown', (e) => {
    if (hud.chatOpen) {
      if (e.code === 'Enter') {
        const text = hud.closeChat().trim(); input.blocked = false;
        if (text === '/replay') {
          // 리플레이 저장 (치트 아님 — 항상 가능)
          const bytes = session.exportReplay();
          if (bytes.length) { downloadBytes(bytes, replayFileName(room)); hud.pushLog(t('replaySaved')); }
        } else if (text.startsWith('/')) {
          // [DEV] 치트 콘솔 — 릴리즈 시 아래 한 줄을 주석 처리
          const w0 = session.world;
          const ctx = w0 ? { spawnX: w0.spawnX, mapW: w0.map.w, team: w0.getPlayer(session.pid)?.team ?? 0, groundY: (tx: number) => { let ty = 0; while (ty < w0.map.h - 1 && !w0.map.isSolid(tx, ty)) ty++; return ty; } } : undefined;
          const handled = CHEATS_ENABLED && runCheat(text, { log: (m) => hud.pushLog(m), request: (c, a0 = 0, a1 = 0) => { input.cheatRequest = c; input.cheatA0 = a0; input.cheatA1 = a1; } }, ctx);
          if (!handled) hud.pushLog(t('unknownCmd', { cmd: text }));
        } else if (text) session.sendChat(text);
        e.preventDefault();
      }
      else if (e.code === 'Escape') { hud.closeChat(); input.blocked = false; e.preventDefault(); }
      e.stopImmediatePropagation();
      return;
    }
    if (e.code === 'Enter') { hud.openChat(); input.keys.clear(); input.blocked = true; e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.code === 'Backquote') { hud.openChat('/'); input.keys.clear(); input.blocked = true; e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.code === 'Escape') { hud.toggleSettings(); e.preventDefault(); }
  }, true);
  (window as unknown as { __session: unknown }).__session = session;
  session.start(performance.now());
  hud.pushLog(offline ? t('offlineMode') : t('roomShare', { room, url: location.href }));
  window.addEventListener('pagehide', () => session.leave());
  window.addEventListener('beforeunload', () => session.leave());

  let lastTick = -1, lastStepAt = performance.now(), lastFrame = performance.now();
  let attached = false;

  const buildInput = (): Input => {
    let buttons = 0;
    if (input.key('KeyA', 'ArrowLeft')) buttons |= BTN_LEFT;
    if (input.key('KeyD', 'ArrowRight')) buttons |= BTN_RIGHT;
    if (input.key('KeyW', 'ArrowUp')) buttons |= BTN_UP;
    if (input.key('KeyS', 'ArrowDown')) buttons |= BTN_DOWN;
    if (input.key('Space', 'KeyW', 'ArrowUp')) buttons |= BTN_JUMP;
    if (input.mouse(0)) buttons |= BTN_ACTION1;
    if (input.mouse(2) || input.key('ShiftLeft')) buttons |= BTN_ACTION2;
    if (input.key('KeyE')) buttons |= BTN_USE;
    let cx = 0, cy = 0;
    const world = session.world;
    const p = world?.getPlayer(session.pid);
    if (p) {
      const [wx, wy] = renderer.screenToWorld(input.mouseX, input.mouseY);
      const cls = CLASSES[p.cls];
      cx = Math.round(wx - (p.x / FP_ONE + cls.width / 2));
      cy = Math.round(wy - (p.y / FP_ONE + cls.height / 2));
      cx = Math.max(-127, Math.min(127, cx));
      cy = Math.max(-127, Math.min(127, cy));
      const n = cls.hotbar.length;
      if (input.slot >= n) input.slot = n - 1;
    }
    return { buttons, cx, cy, slot: input.slot, cls: input.clsRequest, cheat: input.cheatRequest, a0: input.cheatA0, a1: input.cheatA1 };
  };

  // 세션(네트워크/시뮬)은 워커 타이머로 구동 → 탭이 숨겨져도 계속 동기화됨. 렌더링만 rAF.
  let lastSessionUpdate = 0;
  const stepSession = () => {
    const now = performance.now();
    if (now - lastSessionUpdate < 4) return;
    lastSessionUpdate = now;
    session.update(now, buildInput());
    if (session.emittedLast > 0) input.consumed();
  };
  startBackgroundTicker(16, stepSession);

  app.ticker.add(() => {
    const now = performance.now();
    const dtMs = Math.min(100, now - lastFrame);
    lastFrame = now;
    stepSession();
    const world = session.world;
    const st = session.status(now);
    let inBase = false;
    if (world && session.phase === 'playing') {
      if (!attached) { renderer.attachWorld(world); attached = true; }
      if (world.tick !== lastTick) { lastTick = world.tick; lastStepAt = now; }
      const alpha = Math.min(1, (now - lastStepAt) / TICK_MS);
      renderer.update(world, alpha, dtMs / TICK_MS, session.pid, app.screen.width, app.screen.height);
      const p = world.getPlayer(session.pid);
      if (p && p.state === PlayerState.Alive) {
        inBase = world.inBase(p);
      }
    } else if (attached && !world) attached = false;
    hud.showBoard = input.key('Tab');
    if (world) { const lp = world.getPlayer(session.pid); if (lp) { sound.listenerX = lp.x / FP_ONE; sound.listenerY = lp.y / FP_ONE; } }
    const lp = world && session.phase === 'playing' ? world.getPlayer(session.pid) : undefined;
    hud.update(session.phase === 'playing' ? world : null, session.pid, st, inBase, lp ? world!.canMount(lp) : false);
  });
}

main().catch((e) => { console.error(e); alert('Failed to start: ' + e); });
