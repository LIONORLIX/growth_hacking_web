/** p5 WEBGL：标准顶点 + 高度图采样 1D 色标（uRampTex）的片元着色器。 */

/** 与 p5 WEBGL 官方 createShader 示例一致：顶点里不要写 precision highp int（部分驱动会编译失败） */
export const heightmapRampVert = `
precision highp float;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;

void main() {
  vTexCoord = aTexCoord;
  vec4 positionVec4 = vec4(aPosition, 1.0);
  gl_Position = uProjectionMatrix * uModelViewMatrix * positionVec4;
}
`;

export const heightmapRampFrag = `
#ifdef GL_ES
precision highp float;
#endif

varying vec2 vTexCoord;

uniform sampler2D uRampTex;
uniform vec2 uResolution;
uniform vec3 uFlow;
uniform float uWaveAmp;
uniform vec2 uWaveOmega;
uniform vec4 uWaveSpatial;
uniform float uWaveSecondary;
uniform float uNoiseScale;
uniform float uGrain;
uniform float uRampDu;

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
    -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.52;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    v += a * snoise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vTexCoord;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  uv.x *= aspect;

  float t = uFlow.z;
  vec2 q = uv * uNoiseScale + uFlow.xy;

  // 域扭曲：相位随时间振荡 + 随空间变化 → 波纹感，无持续单向平移
  vec2 w1 = uWaveAmp * vec2(
    sin(t * uWaveOmega.x + q.x * uWaveSpatial.x + q.y * uWaveSpatial.y),
    cos(t * uWaveOmega.y + q.x * uWaveSpatial.z + q.y * uWaveSpatial.w)
  );
  float a2 = uWaveAmp * uWaveSecondary;
  vec2 w2 = a2 * vec2(
    cos(t * uWaveOmega.y * 1.27 - q.y * (uWaveSpatial.x + uWaveSpatial.z) * 0.85),
    sin(t * uWaveOmega.x * 1.19 + q.x * (uWaveSpatial.y + uWaveSpatial.w) * 0.9)
  );
  vec2 p = q + w1 + w2;

  float h = fbm(p) * 0.5 + 0.5;
  h = clamp(h, 0.002, 0.998);

  float du = uRampDu;
  vec3 col =
    texture2D(uRampTex, vec2(clamp(h - du, 0.001, 0.999), 0.5)).rgb * 0.25 +
    texture2D(uRampTex, vec2(h, 0.5)).rgb * 0.5 +
    texture2D(uRampTex, vec2(clamp(h + du, 0.001, 0.999), 0.5)).rgb * 0.25;

  float gn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  col += gn * uGrain;

  gl_FragColor = vec4(col, 1.0);
}
`;
