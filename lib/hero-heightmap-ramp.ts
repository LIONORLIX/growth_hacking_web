/**
 * Hero 高度图背景：由稳定 seed 生成「多 stop 色标」的 1D 查找表（供 fragment shader 采样）。
 * 原理：噪声值 h∈[0,1] → 在色标上取色，与 OpenAI 早期视觉里 heightmap + color ramp 一致。
 */

import { baseHueFromSeedAndTheme } from "@/lib/hero-parametric-gradient";

function hash32(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return hash >>> 0;
}

function createSeededRandom(seed: string): () => number {
  let state = hash32(seed) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hslToRgbByte(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lig = Math.max(0, Math.min(100, l)) / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = lig - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c);
  };
  return [f(0), f(8), f(4)];
}

function smoothstep01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** sRGB 字节 → 线性，用于 stop 之间插值，减轻条带 */
function srgbByteToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbByte(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  const y = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(y * 255);
}

export type HeightmapColorStop = { t: number; rgb: [number, number, number] };

/** 生成已按 t 排序的色标 stop（首尾固定 0 / 1）。 */
export function heroHeightmapStopsFromSeed(
  seed: string,
  themeBaseHex?: string | null,
  themeAccentHexes: string[] = [],
): HeightmapColorStop[] {
  const rand = createSeededRandom(`${seed}:heightmap-stops`);
  const h0 = hash32(seed);
  const baseHue = baseHueFromSeedAndTheme(seed, themeBaseHex);
  const step1 = 18 + ((h0 >> 6) % 28);
  const step2 = 44 + ((h0 >> 12) % 36);
  const themeHue1 = themeAccentHexes[0]
    ? baseHueFromSeedAndTheme(seed, themeAccentHexes[0])
    : null;
  const themeHue2 = themeAccentHexes[1]
    ? baseHueFromSeedAndTheme(seed, themeAccentHexes[1])
    : null;
  const huePalette = [
    baseHue,
    themeHue1 ?? (baseHue + step1) % 360,
    themeHue2 ?? (baseHue + step2) % 360,
    (baseHue + 92 + ((h0 >> 3) % 36)) % 360,
  ];

  const nInner = 5;
  const innerTs: number[] = [];
  for (let i = 0; i < nInner; i += 1) {
    innerTs.push(rand());
  }
  innerTs.sort((a, b) => a - b);

  const stops: HeightmapColorStop[] = [];
  const deepSat = 52 + ((h0 >> 18) % 18);
  const midSat = Math.min(72, deepSat + 8 + ((h0 >> 22) % 10));
  const glowSat = Math.max(38, deepSat - ((h0 >> 26) % 12));

  stops.push({
    t: 0,
    rgb: hslToRgbByte(baseHue, deepSat, 22 + ((h0 >> 4) % 18)),
  });

  for (let i = 0; i < nInner; i += 1) {
    const spanHue = huePalette[i % huePalette.length]!;
    const jitter = (rand() - 0.5) * 28;
    const hue = (spanHue + jitter + 360) % 360;
    const sat = midSat + (rand() - 0.5) * 16;
    const light = 38 + rand() * 48;
    stops.push({ t: innerTs[i], rgb: hslToRgbByte(hue, sat, light) });
  }

  stops.push({
    t: 1,
    rgb: hslToRgbByte((baseHue + step1 + step2) % 360, glowSat, 78 + ((h0 >> 8) % 18)),
  });

  stops.sort((a, b) => a.t - b.t);

  const eps = 1e-4;
  for (let i = 1; i < stops.length; i += 1) {
    if (stops[i].t <= stops[i - 1].t) {
      stops[i] = { ...stops[i], t: Math.min(1, stops[i - 1].t + eps) };
    }
  }

  return stops;
}

function sampleStopsRgb(stops: HeightmapColorStop[], t: number): [number, number, number] {
  if (stops.length === 0) return [128, 128, 128];
  if (t <= stops[0].t) return stops[0].rgb;
  const last = stops[stops.length - 1];
  if (t >= last.t) return last.rgb;

  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t <= b.t) {
      const u = (t - a.t) / Math.max(b.t - a.t, 1e-6);
      const s = smoothstep01(u);
      const ar = srgbByteToLinear(a.rgb[0]);
      const ag = srgbByteToLinear(a.rgb[1]);
      const ab = srgbByteToLinear(a.rgb[2]);
      const br = srgbByteToLinear(b.rgb[0]);
      const bg = srgbByteToLinear(b.rgb[1]);
      const bb = srgbByteToLinear(b.rgb[2]);
      return [
        linearToSrgbByte(ar + (br - ar) * s),
        linearToSrgbByte(ag + (bg - ag) * s),
        linearToSrgbByte(ab + (bb - ab) * s),
      ];
    }
  }
  return last.rgb;
}

/** 横向 1D 渐变条 RGBA 像素，宽度 width，高度 1。 */
export function heroHeightmapRampPixels(
  seed: string,
  width = 256,
  themeBaseHex?: string | null,
  themeAccentHexes: string[] = [],
): Uint8ClampedArray {
  const stops = heroHeightmapStopsFromSeed(seed, themeBaseHex, themeAccentHexes);
  const out = new Uint8ClampedArray(width * 4);
  for (let i = 0; i < width; i += 1) {
    const t = width <= 1 ? 0 : i / (width - 1);
    const [r, g, b] = sampleStopsRgb(stops, t);
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
  return out;
}

/** 与噪声场配套的稳定平移（每 seed 不同云形）。 */
export function heroHeightmapNoiseOrigin(seed: string): [number, number] {
  const h = hash32(`${seed}:noise-origin`);
  const x = ((h & 0xffff) / 65535) * 24 - 2;
  const y = (((h >> 16) & 0xffff) / 65535) * 24 - 2;
  return [x, y];
}
