/** DOM 기반 HUD: 체력, 자원, 핫바, 점수, 네트워크 상태. 값이 바뀔 때만 DOM 갱신. */
import { CLASSES, ITEM_BY_ID, RESOURCE_KINDS, TILE_TABLE } from '../data/defs';
import { World } from '../sim/world';
import { PlayerState } from '../sim/types';
import type { SessionStatus } from '../net/session';
import { buildIconDataUrl } from './partsFactory';
import { t, dataLabel, langButtonsHtml, setLang, type Lang } from './i18n';

export class Hud {
  root: HTMLDivElement;
  private top: HTMLDivElement;
  private bottom: HTMLDivElement;
  private status: HTMLDivElement;
  private center: HTMLDivElement;
  private lastKey = '';
  private lastStatusKey = '';
  private icons = new Map<string, string>();
  private log: string[] = [];
  private logEl: HTMLDivElement;
  private feedEl: HTMLDivElement;
  private boardEl: HTMLDivElement;
  private feed: { text: string; at: number }[] = [];
  private minimap: HTMLCanvasElement;
  private chatEl: HTMLDivElement;
  chatBox: HTMLDivElement;
  chatInput: HTMLInputElement;
  settingsEl: HTMLDivElement;
  private chat: { text: string; at: number }[] = [];
  private minimapFrame = 0;
  showBoard = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top"></div>
      <div class="hud-center"></div>
      <div class="hud-log"></div>
      <div class="hud-bottom"></div>
      <div class="hud-status"></div>
      <div class="hud-feed"></div>
      <div class="hud-board" hidden></div>
      <canvas class="hud-minimap" width="224" height="96"></canvas>
      <div class="hud-chat"></div>
      <div class="hud-chatbox" hidden><input maxlength="120"></div>
      <div class="hud-settings" hidden>
        <h3 class="set-title"></h3>
        <label><span class="set-vol-l"></span> <input type="range" class="set-vol" min="0" max="100"></label>
        <label><span class="set-zoom-l"></span> <select class="set-zoom"><option value="2">2x</option><option value="3">3x</option><option value="4">4x</option></select></label>
        <div class="set-lang-l"></div>
        <div class="langs set-langs"></div>
        <div class="small set-close"></div>
      </div>`;
    parent.appendChild(this.root);
    this.top = this.root.querySelector('.hud-top')!;
    this.center = this.root.querySelector('.hud-center')!;
    this.bottom = this.root.querySelector('.hud-bottom')!;
    this.status = this.root.querySelector('.hud-status')!;
    this.logEl = this.root.querySelector('.hud-log')!;
    this.feedEl = this.root.querySelector('.hud-feed')!;
    this.boardEl = this.root.querySelector('.hud-board')!;
    this.minimap = this.root.querySelector('.hud-minimap')!;
    this.chatEl = this.root.querySelector('.hud-chat')!;
    this.chatBox = this.root.querySelector('.hud-chatbox')!;
    this.chatInput = this.chatBox.querySelector('input')!;
    this.settingsEl = this.root.querySelector('.hud-settings')!;
    this.chatBox.style.pointerEvents = 'auto';
    this.settingsEl.style.pointerEvents = 'auto';
    this.relabel();
  }

  /** 정적 문자열을 현재 언어로 다시 씀 (언어 변경 시 호출; 동적 HUD 는 매 프레임 t() 사용) */
  relabel(): void {
    this.chatInput.placeholder = t('chatPlaceholder');
    this.settingsEl.querySelector('.set-title')!.textContent = t('settings');
    this.settingsEl.querySelector('.set-vol-l')!.textContent = t('volume');
    this.settingsEl.querySelector('.set-zoom-l')!.textContent = t('zoom');
    this.settingsEl.querySelector('.set-lang-l')!.textContent = t('language');
    this.settingsEl.querySelector('.set-close')!.textContent = t('closeHint');
    const langs = this.settingsEl.querySelector<HTMLDivElement>('.set-langs')!;
    langs.innerHTML = langButtonsHtml();
    langs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      setLang(b.dataset.lang as Lang);
      this.lastKey = ''; this.lastStatusKey = '';
      this.relabel();
    }));
  }

  private icon(key: string): string {
    let u = this.icons.get(key);
    if (!u) { u = buildIconDataUrl(key); this.icons.set(key, u); }
    return u;
  }

  /** 킬 피드 */
  pushFeed(text: string): void {
    this.feed.push({ text, at: performance.now() });
    if (this.feed.length > 5) this.feed.shift();
    this.renderFeed();
  }
  private renderFeed(): void {
    const now = performance.now();
    this.feed = this.feed.filter((f) => now - f.at < 6000);
    this.feedEl.innerHTML = this.feed.map((f) => `<div>${f.text}</div>`).join('');
  }

  /** 채팅 메시지 표시 (최근 8개, 12초 후 사라짐) */
  pushChat(name: string, text: string, team: number): void {
    const col = team === 0 ? 'blue' : team === 1 ? 'red' : '';
    this.chat.push({ text: `<b class="${col}">${escapeHtml(name)}</b>: ${escapeHtml(text)}`, at: performance.now() });
    if (this.chat.length > 8) this.chat.shift();
    this.renderChat();
  }
  private renderChat(): void {
    const now = performance.now();
    this.chat = this.chat.filter((c) => now - c.at < 12000 || !this.chatBox.hidden);
    this.chatEl.innerHTML = this.chat.map((c) => `<div>${c.text}</div>`).join('');
  }
  get chatOpen(): boolean { return !this.chatBox.hidden; }
  openChat(prefill = ''): void { this.chatBox.hidden = false; this.chatInput.value = prefill; this.chatInput.focus(); this.chatInput.setSelectionRange(prefill.length, prefill.length); this.renderChat(); }
  closeChat(): string { const v = this.chatInput.value; this.chatBox.hidden = true; this.chatInput.blur(); return v; }
  toggleSettings(): void { this.settingsEl.hidden = !this.settingsEl.hidden; }

  /** 미니맵: 타일 종류별 색 + 플레이어/깃발 점. 20프레임마다 갱신 */
  private drawMinimap(world: World, localPid: number): void {
    if (this.minimapFrame++ % 20 !== 0) return;
    const m = world.map;
    const c = this.minimap;
    if (c.width !== m.w || c.height !== m.h) { c.width = m.w; c.height = m.h; }
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(m.w, m.h);
    const d = img.data;
    for (let i = 0; i < m.w * m.h; i++) {
      const t = m.type[i];
      let r = 0, g = 0, b = 0, a = 0;
      if (t === 0) {
        if (m.water[i] > 0) { r = 60; g = 130; b = 255; a = 220; }
        else if (m.backType[i] !== 0) { r = 60; g = 40; b = 25; a = 200; }
      } else {
        const name = TILE_TABLE[t].name;
        a = 255;
        if (name === 'dirt') { r = 122; g = 82; b = 48; }
        else if (name === 'grass') { r = 76; g = 154; b = 60; }
        else if (name === 'stone') { r = 125; g = 125; b = 133; }
        else if (name === 'gold_ore') { r = 224; g = 176; b = 32; }
        else if (name === 'bedrock') { r = 40; g = 40; b = 46; }
        else if (name === 'tree_trunk' || name === 'tree_leaf') { r = 50; g = 120; b = 45; }
        else if (TILE_TABLE[t].door) { r = 255; g = 200; b = 120; }
        else if (TILE_TABLE[t].shop) { r = 255; g = 230; b = 80; }
        else { r = 190; g = 160; b = 110; }
      }
      d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    for (const f of world.flags) { ctx.fillStyle = f.team === 0 ? '#4a7bff' : '#ff4a4a'; ctx.fillRect((f.x >> 11) - 1, (f.y >> 11) - 2, 3, 3); }
    for (const p of world.players) {
      if (p.state !== PlayerState.Alive) continue;
      ctx.fillStyle = p.id === localPid ? '#ffffff' : p.team === 0 ? '#9ab0ff' : '#ffa0a0';
      ctx.fillRect((p.x >> 11) - 1, (p.y >> 11) - 1, 2, 3);
    }
  }

  pushLog(s: string): void {
    this.log.push(s);
    if (this.log.length > 6) this.log.shift();
    this.logEl.innerHTML = this.log.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  }

  update(world: World | null, localPid: number, st: SessionStatus, inBase: boolean): void {
    const p = world?.getPlayer(localPid);
    const statusKey = `${st.phase}|${st.pid}|${st.members}|${st.coordinator}|${st.stalledMs > 1000}|${st.desyncs}|${st.message}`;
    if (statusKey !== this.lastStatusKey) {
      this.lastStatusKey = statusKey;
      this.status.innerHTML = `<span>${t('phase_' + st.phase)}</span> · ${st.members} ${t('players')} · <span translate="no">pid ${st.pid}</span>${st.coordinator ? ` · ${t('coordinator')}` : ''}${st.stalledMs > 1000 ? ` · <b class="warn">${t('waiting')}</b>` : ''}${st.desyncs ? ` · ${st.desyncs} ${t('resyncs')}` : ''}<br><small>${escapeHtml(st.message)}</small>`;
    }
    if (this.feed.length && performance.now() - this.feed[0].at > 6000) this.renderFeed();
    if (this.chat.length && performance.now() - this.chat[0].at > 12000) this.renderChat();
    if (!world) { this.top.innerHTML = ''; this.bottom.innerHTML = ''; this.center.innerHTML = ''; this.boardEl.hidden = true; return; }
    this.drawMinimap(world, localPid);
    // 점수판 (Tab)
    this.boardEl.hidden = !this.showBoard;
    if (this.showBoard) {
      const rows = (team: number) => world.players.filter((q) => q.team === team).sort((a, b) => b.kills - a.kills)
        .map((q) => `<tr class="${q.id === localPid ? 'me' : ''}"><td translate="no">${escapeHtml(q.name)}</td><td>${dataLabel(CLASSES[q.cls])}</td><td>${q.kills}</td><td>${q.deaths}</td><td>${q.state === PlayerState.Alive ? '' : '💀'}</td></tr>`).join('');
      this.boardEl.innerHTML = `<div class="teams"><table><tr><th class="blue" colspan="5">${t('blue')} ${world.score[0]}</th></tr><tr><th>${t('nameCol')}</th><th>${t('classCol')}</th><th>K</th><th>D</th><th></th></tr>${rows(0)}</table>
        <table><tr><th class="red" colspan="5">${t('red')} ${world.score[1]}</th></tr><tr><th>${t('nameCol')}</th><th>${t('classCol')}</th><th>K</th><th>D</th><th></th></tr>${rows(1)}</table></div><div class="small">${t('round')} ${world.round} · ${t('tick')} ${world.tick}</div>`;
    }
    const score = `${world.score[0]}:${world.score[1]}`;
    const key = p
      ? `${score}|${p.cls}|${p.hp}|${p.wood}|${p.stone}|${p.gold}|${p.slot}|${p.bombs}|${p.arrows}|${p.state}|${p.respawnAt - world.tick}|${inBase}|${world.roundOverAt}|${p.kills}|${p.deaths}|${p.carryingFlag}`
      : `${score}|none`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    // 상단: 점수 + 체력 + 자원
    let topHtml = `<div class="score"><span class="blue">${world.score[0]}</span> : <span class="red">${world.score[1]}</span></div>`;
    if (p) {
      const cls = CLASSES[p.cls];
      const hearts = Math.ceil(cls.hp / 4);
      let h = '';
      for (let i = 0; i < hearts; i++) {
        const v = Math.max(0, Math.min(4, p.hp - i * 4));
        h += `<span class="heart" style="opacity:${0.25 + 0.75 * (v / 4)}">♥</span>`;
      }
      topHtml += `<div class="hp">${h}</div>`;
      topHtml += `<div class="res" translate="no">${RESOURCE_KINDS.map((r) => `<span class="${r}">${r === 'wood' ? '🪵' : r === 'stone' ? '🪨' : '🪙'} ${p[r]}</span>`).join('')}</div>`;
      topHtml += `<div class="kd">K ${p.kills} / D ${p.deaths}${p.carryingFlag >= 0 ? ' · ' + t('carryingFlag') : ''}</div>`;
    }
    this.top.innerHTML = topHtml;

    // 중앙 메시지
    let centerHtml = '';
    if (world.roundOverAt > 0) {
      const winner = world.score[0] > world.score[1] ? `<span class="blue">${t('blue')}</span>` : `<span class="red">${t('red')}</span>`;
      centerHtml = `<div class="big">${t('teamWins', { team: winner })}</div><div>${t('newRound')}</div>`;
    } else if (p && p.state === PlayerState.Dead) {
      const s = Math.max(0, Math.ceil((p.respawnAt - world.tick) / 30));
      centerHtml = `<div class="big">${t('dead')}</div><div>${t('respawnIn', { s })}</div>`;
    } else if (p && inBase) {
      centerHtml = `<div class="hint">${t('baseHint')}</div>`;
    }
    this.center.innerHTML = centerHtml;

    // 하단: 핫바
    if (p) {
      const cls = CLASSES[p.cls];
      let bar = '';
      cls.hotbar.forEach((id, i) => {
        const it = ITEM_BY_ID.get(id);
        if (!it) return;
        const sel = i === p.slot ? ' sel' : '';
        let extra = '';
        if (it.id === 'bomb') extra = `<span class="cnt">${p.bombs}</span>`;
        if (it.id === 'bow') extra = `<span class="cnt">${p.arrows}</span>`;
        if (it.cost) {
          const afford = RESOURCE_KINDS.every((r) => !it.cost![r] || p[r] >= it.cost![r]!);
          extra = `<span class="cost${afford ? '' : ' no'}">${RESOURCE_KINDS.filter((r) => it.cost![r]).map((r) => `${it.cost![r]}${r === 'wood' ? '🪵' : r === 'stone' ? '🪨' : '🪙'}`).join(' ')}</span>`;
        }
        bar += `<div class="slot${sel}" title="${dataLabel(it)}"><span class="num">${i + 1}</span><img src="${this.icon(it.icon)}" alt="">${extra}</div>`;
      });
      this.bottom.innerHTML = `<div class="cls">${dataLabel(cls)}</div><div class="hotbar">${bar}</div>`;
    } else this.bottom.innerHTML = '';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
