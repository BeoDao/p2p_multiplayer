/**
 * 엔티티 아웃라인 필터 (PixiJS 8, WebGL).
 * 레이어 전체에 한 번 적용: 투명 픽셀 중 불투명 이웃이 있으면 그 이웃 색을 어둡게 한 색으로 칠한다.
 * → 캐릭터·탈것·드롭·투사체가 각자 자기 색보다 어두운 1px(월드 픽셀) 테두리를 갖는다. 스프라이트마다 뭔가 추가할 필요 없음.
 */
import { Filter, GlProgram } from 'pixi.js';

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) { return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void) { gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }
`;

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform highp vec4 uInputSize; // 정점 셰이더(highp)와 정밀도를 맞춰야 링크된다
uniform highp vec4 uInputClamp;
uniform float uThickness;
uniform float uDarken;
vec4 tap(vec2 off) { return texture(uTexture, clamp(vTextureCoord + off, uInputClamp.xy, uInputClamp.zw)); }
void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  if (c.a > 0.02) { finalColor = c; return; }
  vec2 d = vec2(uThickness) * uInputSize.zw;
  vec4 best = vec4(0.0);
  vec4 n;
  n = tap(vec2( d.x, 0.0)); if (n.a > best.a) best = n;
  n = tap(vec2(-d.x, 0.0)); if (n.a > best.a) best = n;
  n = tap(vec2(0.0,  d.y)); if (n.a > best.a) best = n;
  n = tap(vec2(0.0, -d.y)); if (n.a > best.a) best = n;
  if (best.a > 0.02) {
    vec3 rgb = best.rgb / best.a; // premultiplied 해제
    finalColor = vec4(rgb * uDarken * best.a, best.a);
  } else finalColor = vec4(0.0);
}
`;

export class OutlineFilter extends Filter {
  constructor(thickness = 1, darken = 0.45) {
    super({
      glProgram: GlProgram.from({ vertex, fragment, name: 'entity-outline' }),
      resources: { outlineUniforms: { uThickness: { value: thickness, type: 'f32' }, uDarken: { value: darken, type: 'f32' } } },
      padding: 4,
    });
  }
  /** 화면 픽셀 단위 두께 (월드 1px = zoom 화면 px) */
  set thickness(v: number) {
    (this.resources.outlineUniforms as { uniforms: { uThickness: number } }).uniforms.uThickness = v;
    this.padding = Math.ceil(v) + 2;
  }
}
