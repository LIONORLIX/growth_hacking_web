/**
 * Hero 高度图背景：由稳定 seed 生成「多 stop 色标」的 1D 查找表（供 fragment shader 采样）。
 * 原理：噪声值 h∈[0,1] → 在色标上取色，与 OpenAI 早期视觉里 heightmap + color ramp 一致。
 */

import { baseHueFromSeedAndTheme } from "@/lib/hero-parametric-gradient";

/** 手动可调的 shader 配色参数：色相中心/范围、抖动、饱和度与亮度（HSB/HSV）区间。 */
export const HERO_HEIGHTMAP_COLOR_TUNING = {
  /** 目标色相中心（0–360，蓝色大约在 200–240） */
  hueCenter: 100,
  /** 色相带半宽，实际带宽 ≈ hueCenter ± hueBand */
  hueBand: 120,
  /** stop 间额外色相抖动（度数，建议 0–40） */
  jitterHue: 22,
  /** stop 间额外饱和度抖动（百分比，建议 0–30） */
  jitterSat: 16,
  /** 中间 stop 亮度基线（百分比 0–100，HSB 的 B） */
  valueBase: 80,
  /** 中间 stop 亮度波动范围（百分比，最终在 valueBase ~ valueBase+valueRange） */
  valueRange: 20,
  /** 深色区饱和度基线（百分比 0–100，整体越大颜色越“浓”） */
  satBase: 50,
  /** 深色区饱和度波动范围（百分比，用于 deepSat 的随机变化） */
  satRange: 10,
} as const;

/**
 * 将任意色相收敛到以 hueCenter 为中心、\[hueCenter±hueBand] 的色带。
 * 仍保留 seed 之间的差异，只是整体限制在一个可控的色相范围内。
 */
function remapHueToBand(hue: number): number {
  const h = ((hue % 360) + 360) % 360;
  const t = h / 360;
  const { hueCenter, hueBand } = HERO_HEIGHTMAP_COLOR_TUNING;
  const band = Math.max(0, Math.min(180, hueBand));
  const minH = hueCenter - band;
  const maxH = hueCenter + band;
  return ((minH + (maxH - minH) * t) % 360 + 360) % 360;
}

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

function hsvToRgbByte(h: number, s: number, v: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const val = Math.max(0, Math.min(100, v)) / 100;
  const c = val * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) {
    r1 = c;
    g1 = x;
  } else if (hp < 2) {
    r1 = x;
    g1 = c;
  } else if (hp < 3) {
    g1 = c;
    b1 = x;
  } else if (hp < 4) {
    g1 = x;
    b1 = c;
  } else if (hp < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  const m = val - c;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
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
  const baseHue = remapHueToBand(baseHueFromSeedAndTheme(seed, themeBaseHex));
  const step1 = 18 + ((h0 >> 6) % 28);
  const step2 = 44 + ((h0 >> 12) % 36);
  const themeHue1 = themeAccentHexes[0]
    ? remapHueToBand(baseHueFromSeedAndTheme(seed, themeAccentHexes[0]))
    : null;
  const themeHue2 = themeAccentHexes[1]
    ? remapHueToBand(baseHueFromSeedAndTheme(seed, themeAccentHexes[1]))
    : null;
  const huePalette = [
    baseHue,
    themeHue1 ?? remapHueToBand((baseHue + step1) % 360),
    themeHue2 ?? remapHueToBand((baseHue + step2) % 360),
    remapHueToBand((baseHue + 92 + ((h0 >> 3) % 36)) % 360),
  ];

  const nInner = 5;
  const innerTs: number[] = [];
  for (let i = 0; i < nInner; i += 1) {
    innerTs.push(rand());
  }
  innerTs.sort((a, b) => a - b);

  const stops: HeightmapColorStop[] = [];
  // 略降饱和度、提高整体明度，让配色更偏浅；饱和度基线和范围由配置控制。
  const { satBase, satRange } = HERO_HEIGHTMAP_COLOR_TUNING;
  const deepSat = satBase + ((h0 >> 18) % Math.max(1, satRange));
  const midSat = Math.min(70, deepSat + 6 + ((h0 >> 22) % 8));
  const glowSat = Math.max(36, deepSat - ((h0 >> 26) % 10));

  stops.push({
    t: 0,
    // 原始暗部提升为中等亮度，避免过暗
    rgb: hsvToRgbByte(baseHue, deepSat, 40 + ((h0 >> 4) % 12)),
  });

  for (let i = 0; i < nInner; i += 1) {
    const spanHue = huePalette[i % huePalette.length]!;
    const { jitterHue, jitterSat, valueBase, valueRange } = HERO_HEIGHTMAP_COLOR_TUNING;
    // 在统一色带基础上增加冷暖和明暗变化。
    const jitter = (rand() - 0.5) * jitterHue * 2;
    const hue = (spanHue + jitter + 360) % 360;
    const sat = midSat + (rand() - 0.5) * jitterSat * 2;
    const value = valueBase + rand() * valueRange;
    stops.push({ t: innerTs[i], rgb: hsvToRgbByte(hue, sat, value) });
  }

  stops.push({
    t: 1,
    // 高光进一步偏亮，整体更浅
    rgb: hsvToRgbByte((baseHue + step1 + step2) % 360, glowSat, 84 + ((h0 >> 8) % 12)),
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
