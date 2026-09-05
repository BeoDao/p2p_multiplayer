/**
 * WebAudio 합성 효과음 (외부 파일 없음). 이벤트 종류별 짧은 신호를 만든다.
 * 교체: public/assets/sfx/<kind>.mp3|wav 를 두고 manifest.json 에 { "keys": ["slash", ...] } 를 적으면 그 파일을 대신 재생.
 */
import type { WorldEvent } from '../sim/types';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private lastPlay = new Map<string, number>();
  volume = 0.5;
  /** 청취자 위치(월드 px) — 거리 감쇠용 */
  listenerX = 0; listenerY = 0;

  /** 브라우저 정책상 사용자 입력 후에만 오디오 컨텍스트 생성 가능 */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      void this.loadOverrides();
    } catch { this.ctx = null; }
  }

  private async loadOverrides(): Promise<void> {
    try {
      const res = await fetch('assets/sfx/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const m = (await res.json()) as { keys?: string[] };
      for (const k of m.keys ?? []) {
        for (const ext of ['wav', 'mp3', 'ogg']) {
          try {
            const r = await fetch(`assets/sfx/${k}.${ext}`);
            if (!r.ok) continue;
            const buf = await this.ctx!.decodeAudioData(await r.arrayBuffer());
            this.buffers.set(k, buf);
            break;
          } catch { /* 다음 확장자 */ }
        }
      }
    } catch { /* 없음 */ }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** 월드 이벤트 → 효과음. x,y 는 FP 좌표. */
  onEvent(e: WorldEvent): void {
    if (!this.ctx || !this.master) return;
    const px = e.x / 256, py = e.y / 256;
    const d = Math.hypot(px - this.listenerX, py - this.listenerY);
    const gain = Math.max(0, 1 - d / 320);
    if (gain <= 0.02) return;
    const now = this.ctx.currentTime;
    const key = e.kind + (e.kind === 'hit' && e.team === -1 ? '_block' : '');
    const last = this.lastPlay.get(key) ?? -1;
    if (now - last < 0.03) return; // 같은 틱 중복 억제
    this.lastPlay.set(key, now);
    const file = this.buffers.get(key);
    if (file) { this.playBuffer(file, gain); return; }
    switch (e.kind) {
      case 'slash': this.noise(0.12, 1800, 400, gain * 0.5); break;
      case 'hit': e.team === -1 ? this.tone(900, 0.06, 'square', gain * 0.35, 300) : this.tone(160, 0.12, 'sawtooth', gain * 0.5, 60); break;
      case 'die': this.tone(220, 0.35, 'sawtooth', gain * 0.6, 40); this.noise(0.25, 600, 200, gain * 0.4); break;
      case 'explode': this.noise(0.5, 300, 60, gain * 0.9); this.tone(60, 0.4, 'sine', gain * 0.8, 20); break;
      case 'dig': this.noise(0.05, 2500, 1200, gain * 0.35); this.tone(200 + ((e.tile ?? 0) * 37) % 200, 0.04, 'square', gain * 0.15, 150); break;
      case 'build': this.tone(520, 0.05, 'square', gain * 0.3, 700); break;
      case 'shoot': if (e.tile === 1) { this.noise(0.05, 1800, 400, gain * 0.5); this.tone(160, 0.05, 'square', gain * 0.25, 60); } else { this.noise(0.08, 3000, 800, gain * 0.4); this.tone(700, 0.08, 'triangle', gain * 0.3, 300); } break;
      case 'capture': this.arp([523, 659, 784, 1047], 0.09, gain * 0.5); break;
      case 'pickup': this.arp([440, 660], 0.08, gain * 0.4); break;
      case 'buy': this.arp([880, 1320], 0.06, gain * 0.4); break;
      case 'loot': this.tone(1200, 0.05, 'square', gain * 0.25, 1600); break;
      case 'jump': this.tone(300, 0.08, 'triangle', gain * 0.2, 600); break;
    }
  }

  private playBuffer(buf: AudioBuffer, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master!);
    src.start();
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, endFreq = freq): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), ctx.currentTime + dur);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(this.master!);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  private noise(dur: number, cutoff: number, endCutoff: number, gain: number): void {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, endCutoff), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start();
  }

  private arp(freqs: number[], step: number, gain: number): void {
    const ctx = this.ctx!;
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = f;
      const t = ctx.currentTime + i * step;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + step);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + step + 0.02);
    });
  }
}
