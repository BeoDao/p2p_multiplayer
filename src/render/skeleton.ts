/**
 * 2D 스켈레탈 애니메이션.
 * - Skeleton: 본 트리(순수 변환 계산). 각 본의 로컬 회전/오프셋을 애니메이션이 구동하고 월드 행렬을 계산한다.
 * - Skin: 본에 파츠 Sprite 를 부착. 파츠는 평면 컨테이너에 z 순서로 정렬되고 매 프레임 본 월드 행렬을 따라간다.
 *   → 뒤쪽 팔/앞쪽 다리 같은 전역 정렬이 가능하고, 텍스처 키만 바꾸면 스킨/무기 교체.
 * - Clip: 키프레임 회전 트랙. base 클립 + overlay 클립(팔 등 일부 본만 덮어씀) + 절차적 조준(팔 본).
 * 시뮬레이션과 완전히 분리되어 있으므로 여기서는 부동소수점을 자유롭게 쓴다.
 */
import { Container, Sprite, Matrix, type Texture } from 'pixi.js';
import skeletonJson from '../data/skeleton.json';
import animationsJson from '../data/animations.json';
import skinsJson from '../data/skins.json';
import type { TextureRegistry } from './textures';

interface BoneDef { name: string; parent: string | null; x: number; y: number; length?: number }
interface ClipDef { len: number; loop: boolean; overlay?: boolean; tracks: Record<string, number[][]> }
export interface PartDef { id: string; bone: string; texture: string; ax: number; ay: number; ox?: number; oy?: number; z: number; teamTint?: boolean }
interface SkinDef { extends?: string; parts?: PartDef[]; vars?: Record<string, string> }

const BONES = (skeletonJson as { bones: BoneDef[] }).bones;
const CLIPS = (animationsJson as { clips: Record<string, ClipDef> }).clips;
const SKINS = (skinsJson as { skins: Record<string, SkinDef> }).skins;

export const TEAM_COLORS = [0x4a7bff, 0xff4a4a];

/** 스킨 정의 해석 (상속 + 변수 치환) */
export function resolveSkin(id: string, vars: Record<string, string> = {}): PartDef[] {
  const chain: SkinDef[] = [];
  let cur: SkinDef | undefined = SKINS[id];
  while (cur) { chain.unshift(cur); cur = cur.extends ? SKINS[cur.extends] : undefined; }
  const allVars: Record<string, string> = {};
  let parts: PartDef[] = [];
  for (const s of chain) { Object.assign(allVars, s.vars ?? {}); if (s.parts) parts = s.parts; }
  Object.assign(allVars, vars);
  return parts.map((p) => ({ ...p, texture: p.texture.startsWith('$') ? (allVars[p.texture] ?? 'none') : p.texture }));
}

function sampleTrack(track: number[][], t: number): number {
  if (track.length === 0) return 0;
  if (t <= track[0][0]) return track[0][1];
  for (let i = 1; i < track.length; i++) {
    const [t1, v1] = track[i];
    if (t <= t1) {
      const [t0, v0] = track[i - 1];
      const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * f;
    }
  }
  return track[track.length - 1][1];
}

class Bone {
  rotation = 0;
  offY = 0;
  local = new Matrix();
  world = new Matrix();
  constructor(public def: BoneDef, public parent: Bone | null) {}
}

export class Skeleton {
  /** 파츠 스프라이트가 들어있는 평면 컨테이너. 위치/스케일은 외부에서 설정. */
  root = new Container();
  private bones = new Map<string, Bone>();
  private boneList: Bone[] = [];
  private partSprites = new Map<string, { sp: Sprite; def: PartDef; bone: Bone; baseTint: number }>();
  private baseClip = 'idle';
  private baseTime = 0;
  private overlayClip: string | null = null;
  private overlayTime = 0;
  private blend = 1;
  private prevRot = new Map<string, number>();
  private aim: { bones: string[]; angle: number } | null = null;
  facing = 1;
  private tmp = new Matrix();

  constructor(private tex: TextureRegistry) {
    this.root.sortableChildren = true;
    for (const b of BONES) {
      const bone = new Bone(b, b.parent ? this.bones.get(b.parent)! : null);
      this.bones.set(b.name, bone);
      this.boneList.push(bone);
    }
  }

  setSkin(skinId: string, vars: Record<string, string>, team: number): void {
    for (const { sp } of this.partSprites.values()) sp.destroy();
    this.partSprites.clear();
    for (const p of resolveSkin(skinId, vars)) {
      const bone = this.bones.get(p.bone);
      if (!bone) continue;
      const sp = new Sprite(this.tex.part(p.texture));
      sp.anchor.set(p.ax, p.ay);
      sp.zIndex = p.z;
      const baseTint = p.teamTint ? (TEAM_COLORS[team] ?? 0xffffff) : 0xffffff;
      sp.tint = baseTint;
      this.root.addChild(sp);
      this.partSprites.set(p.id, { sp, def: p, bone, baseTint });
    }
  }

  setPartTexture(partId: string, key: string): void {
    const e = this.partSprites.get(partId);
    if (e) { const t = this.tex.part(key); if (e.sp.texture !== t) e.sp.texture = t; }
  }
  setPartTextureObj(partId: string, t: Texture): void {
    const e = this.partSprites.get(partId);
    if (e && e.sp.texture !== t) e.sp.texture = t;
  }
  /** 파츠의 본 기준 추가 회전(도)/오프셋 (무기별 잡는 각도) */
  setPartOffset(partId: string, rotDeg: number, ox = 0, oy = 0): void {
    const e = this.partSprites.get(partId);
    if (e) e.def = { ...e.def, rot: rotDeg, ox, oy } as PartDef & { rot: number };
  }
  setPartVisible(partId: string, v: boolean): void {
    const e = this.partSprites.get(partId);
    if (e) e.sp.visible = v;
  }
  setTint(color: number | null): void {
    for (const { sp, baseTint } of this.partSprites.values()) sp.tint = color ?? baseTint;
  }

  play(clip: string, restart = false): void {
    if (clip === this.baseClip && !restart) return;
    for (const [n, b] of this.bones) this.prevRot.set(n, b.rotation);
    this.baseClip = CLIPS[clip] ? clip : 'idle';
    this.baseTime = 0;
    this.blend = 0;
  }
  get current(): string { return this.baseClip; }
  playOverlay(clip: string): void {
    this.overlayClip = CLIPS[clip] ? clip : null;
    this.overlayTime = 0;
  }
  stopOverlay(): void { this.overlayClip = null; }
  /** 조준: bones[0] 이 각도(라디안, 오른쪽=0, 아래=+)를 향하고 나머지는 펴짐 */
  setAim(bones: string[] | null, angleRad = 0): void {
    this.aim = bones ? { bones, angle: angleRad } : null;
  }

  /** dt: 틱 단위 */
  update(dt: number): void {
    const clip = CLIPS[this.baseClip];
    this.baseTime += dt;
    if (clip.loop) this.baseTime %= clip.len; else this.baseTime = Math.min(this.baseTime, clip.len);
    this.blend = Math.min(1, this.blend + dt / 4);
    const rot = new Map<string, number>();
    let rootY = 0;
    for (const [name, track] of Object.entries(clip.tracks)) {
      if (name === 'root.y') rootY = sampleTrack(track, this.baseTime);
      else rot.set(name, sampleTrack(track, this.baseTime));
    }
    if (this.overlayClip) {
      const oc = CLIPS[this.overlayClip];
      this.overlayTime += dt;
      if (this.overlayTime >= oc.len) this.overlayClip = null;
      else for (const [name, track] of Object.entries(oc.tracks)) rot.set(name, sampleTrack(track, this.overlayTime));
    }
    for (const bone of this.boneList) {
      const name = bone.def.name;
      let target = ((rot.get(name) ?? 0) * Math.PI) / 180;
      if (this.aim && this.aim.bones.includes(name)) {
        // 본의 길이 방향은 +y(아래). 오른쪽(0rad)을 향하려면 -90도. facing<0 이면 루트가 x 반전되므로 각도를 거울상으로.
        const a = this.facing < 0 ? Math.PI - this.aim.angle : this.aim.angle;
        target = name === this.aim.bones[0] ? a - Math.PI / 2 : 0;
      }
      if (this.blend < 1 && !(this.aim && this.aim.bones.includes(name))) {
        const prev = this.prevRot.get(name) ?? target;
        target = prev + (target - prev) * this.blend;
      }
      bone.rotation = target;
      bone.offY = name === 'hip' ? rootY : 0;
    }
    // 월드 행렬
    for (const bone of this.boneList) {
      const d = bone.def;
      // local = T(부모 기준 오프셋) * R(회전)
      bone.local.set(Math.cos(bone.rotation), Math.sin(bone.rotation), -Math.sin(bone.rotation), Math.cos(bone.rotation), d.x, d.y + bone.offY);
      if (bone.parent) bone.world.copyFrom(bone.parent.world).append(bone.local);
      else bone.world.copyFrom(bone.local);
    }
    // 파츠 배치
    for (const { sp, def, bone } of this.partSprites.values()) {
      const m = this.tmp.copyFrom(bone.world);
      const rot = ((def as PartDef & { rot?: number }).rot ?? 0) * (Math.PI / 180);
      if (def.ox || def.oy || rot) m.append(new Matrix(Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), def.ox ?? 0, def.oy ?? 0));
      sp.position.set(m.tx, m.ty);
      sp.rotation = Math.atan2(m.b, m.a);
    }
    this.root.scale.x = this.facing;
  }
}
