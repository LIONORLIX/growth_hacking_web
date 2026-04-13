/**
 * Hero / Playbook 卡片底图：由**稳定字符串 seed** 经 `hash32` 确定性推出色相、饱和度、椭圆位置等，
 * 再拼成 CSS `background-image`（多层 radial + linear）或供 WebGL 取色（{@link heroShaderHexColorsFromSeed}）。
 *
 * **Playbook 多维表格**：列表与详情应通过 {@link heroGradientSeedForRecord} 生成 seed——
 * **优先使用表格「Slug」列**（字段名常见为 `Slug` / `slug` / `SLUG`）的文本作为**主种子**；
 * 无 Slug 时回退到 `Title`，再回退 `untitled`，并与 `record_id` 组合以保证行级稳定与冲突区分。
 * **「theme」列**：若单元格文本中含色值（如 `#3b82f6`、`rgb(59,130,246)`），则 {@link themeHexFromFields} 解析后作为
 * {@link getHeroParametricGradient} / WebGL ramp 的**基准色相**；步进与噪声仍由 seed 决定。
 *
 * 后续可改为请求独立接口（例如 `/api/hero-gradient?seed=`）并在此封装替换实现。
 */
function hash32(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return hash >>> 0;
}

function pick(h: number, shift: number, mod: number): number {
  return Math.floor((h >> shift) % mod);
}

const THEME_FIELD_KEYS = ["theme", "Theme", "THEME"] as const;
const SEED_FIELD_KEYS = ["seed", "Seed", "SEED"] as const;

function normalizeHex6(hex: string): string | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length === 6 && /^[0-9a-fA-F]{6}$/.test(h)) {
    return `#${h.toLowerCase()}`;
  }
  if (h.length === 8 && /^[0-9a-fA-F]{8}$/.test(h)) {
    return `#${h.slice(0, 6).toLowerCase()}`;
  }
  return null;
}

function rgbToHslByte(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = Math.max(0, Math.min(255, r)) / 255;
  const gn = Math.max(0, Math.min(255, g)) / 255;
  const bn = Math.max(0, Math.min(255, b)) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        break;
      case gn:
        h = ((bn - rn) / d + 2) / 6;
        break;
      default:
        h = ((rn - gn) / d + 4) / 6;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const norm = normalizeHex6(hex);
  if (!norm) return null;
  const h = norm.slice(1);
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  return rgbToHslByte(r, g, b);
}

/** 从任意字符串中提取可识别色值列表（#RGB / #RRGGBB / rgb(...)），按出现顺序去重。 */
export function colorHexesFromText(text: string): string[] {
  const t = text.trim();
  const hits: string[] = [];
  const seen = new Set<string>();

  const hexMatches = t.matchAll(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g);
  for (const m of hexMatches) {
    const h = normalizeHex6(m[0] ?? "");
    if (h && !seen.has(h)) {
      seen.add(h);
      hits.push(h);
    }
  }

  const rgbMatches = t.matchAll(
    /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+\s*)?\)/gi,
  );
  for (const m of rgbMatches) {
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    if ([r, g, b].every((n) => n >= 0 && n <= 255)) {
      const h = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
      if (!seen.has(h)) {
        seen.add(h);
        hits.push(h);
      }
    }
  }
  return hits;
}

/** 从任意字符串中提取首个可识别的色值。 */
export function firstColorHexFromText(text: string): string | null {
  return colorHexesFromText(text)[0] ?? null;
}

/**
 * 多维表格 `theme` 列：若含色值则作为 Hero / Shader 渐变的**基准色相**来源（仍用 seed 做步进与细节抖动）。
 */
export function themeHexFromFields(fields: Record<string, unknown>): string | null {
  return themeHexesFromFields(fields)[0] ?? null;
}

/** `theme` 多色：第一个主色，其余辅助色。 */
export function themeHexesFromFields(fields: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const pushMany = (value: string) => {
    for (const h of colorHexesFromText(value)) {
      if (seen.has(h)) continue;
      seen.add(h);
      out.push(h);
    }
  };
  for (const k of THEME_FIELD_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
    const v = fields[k];
    if (typeof v === "string") {
      pushMany(v);
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const text = o.text;
      if (typeof text === "string") {
        pushMany(text);
      }
      const link = o.link;
      if (typeof link === "string") {
        pushMany(link);
      }
    }
  }
  return out;
}

/** 供渐变 / shader：有 theme 色时用其色相，否则用 seed 哈希色相。 */
export function baseHueFromSeedAndTheme(seed: string, themeBaseHex?: string | null): number {
  if (themeBaseHex) {
    const hsl = hexToHsl(themeBaseHex);
    if (hsl) return Math.round(((hsl.h % 360) + 360) % 360);
  }
  const h = hash32(seed);
  return pick(h, 0, 360);
}

/** 多维表格 Slug 列：兼容 API 返回的字段名大小写（与渐变 seed 同源） */
export function playbookSlugFromFields(fields: Record<string, unknown>): string {
  for (const k of ["Slug", "slug", "SLUG"] as const) {
    const v = fields[k];
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length > 0) return t;
    }
  }
  return "";
}

/** 多维表格 seed 列：兼容字段名大小写；用于直接控制渐变生成。 */
export function playbookSeedFromFields(fields: Record<string, unknown>): string {
  for (const k of SEED_FIELD_KEYS) {
    const v = fields[k];
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length > 0) return t;
    }
  }
  return "";
}

/**
 * Playbook 单行记录 → 喂给 {@link getHeroParametricGradient} / Shader 的 seed 字符串。
 *
 * - **有 Slug**：`「slug」|record_id` —— 渐变主要由 **表格 Slug 字段**决定；末尾拼 `record_id` 防止同 Slug 多行时完全同色。
 * - **无 Slug**：`record_id|「title 或 untitled」` —— 与仅按标题区分时的稳定回退一致。
 */
export function heroGradientSeedForRecord(record: {
  record_id: string;
  fields: {
    Slug?: string;
    slug?: string;
    SLUG?: string;
    seed?: string;
    Seed?: string;
    SEED?: string;
    Title?: string;
    [key: string]: unknown;
  };
}): string {
  const explicitSeed = playbookSeedFromFields(record.fields);
  if (explicitSeed) return explicitSeed;

  const slug = playbookSlugFromFields(record.fields);
  if (slug) return `${slug}|${record.record_id}`;

  const titleRaw = record.fields.Title;
  const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
  const label = title || "untitled";
  return `${record.record_id}|${label}`;
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lig = Math.max(0, Math.min(100, l)) / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = lig - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Shader 专用：邻近色（色相间隔适中，避免贴太紧）+ 中饱和、高明度。
 * 与 {@link getHeroParametricGradient} 使用同一套色相逻辑（CSS 渐变函数仍可用于其它场景）。
 */
export function heroShaderHexColorsFromSeed(
  seed: string,
  themeBaseHex?: string | null,
  themeAccentHexes: string[] = [],
): {
  color1: string;
  color2: string;
  color3: string;
} {
  const h = hash32(seed);
  const baseHue = baseHueFromSeedAndTheme(seed, themeBaseHex);
  const step1 = 22 + pick(h, 6, 26);
  const step2 = 52 + pick(h, 12, 30);
  const hue1 = baseHue;
  const accentHue1 = themeAccentHexes[0] ? baseHueFromSeedAndTheme(seed, themeAccentHexes[0]) : null;
  const accentHue2 = themeAccentHexes[1] ? baseHueFromSeedAndTheme(seed, themeAccentHexes[1]) : null;
  const hue2 = accentHue1 ?? (baseHue + step1) % 360;
  const hue3 = accentHue2 ?? (baseHue + step2) % 360;

  const satBase = 48 + pick(h, 18, 17);
  const sat2 = Math.min(68, satBase + 6 + pick(h, 24, 8));
  const sat3 = Math.max(42, satBase - pick(h, 28, 10));

  const l1 = 88 + pick(h, 4, 8);
  const l2 = 82 + pick(h, 10, 10);
  const l3 = 90 + pick(h, 14, 6);

  return {
    color1: hslToHex(hue1, satBase, l1),
    color2: hslToHex(hue2, sat2, l2),
    color3: hslToHex(hue3, sat3, l3),
  };
}

/**
 * 将任意 **稳定 seed**（如 {@link heroGradientSeedForRecord} 返回值）转为可写进 `style.background` 的多层渐变。
 * 内部：`hash32(seed)` → 从 32 位哈希按位取模得到色相步进、饱和、明度、椭圆中心百分比与线性角度。
 */
export function getHeroParametricGradient(
  seed: string,
  themeBaseHex?: string | null,
  themeAccentHexes: string[] = [],
): string {
  const h = hash32(seed);

  const baseHue = baseHueFromSeedAndTheme(seed, themeBaseHex);
  const step1 = 22 + pick(h, 6, 26);
  const step2 = 52 + pick(h, 12, 30);
  const hueA = baseHue;
  const hueB = themeAccentHexes[0]
    ? baseHueFromSeedAndTheme(seed, themeAccentHexes[0])
    : (baseHue + step1) % 360;
  const hueC = themeAccentHexes[1]
    ? baseHueFromSeedAndTheme(seed, themeAccentHexes[1])
    : (baseHue + step2) % 360;
  const hueD = (baseHue + 96 + pick(h, 2, 48)) % 360;

  const sat = 48 + pick(h, 18, 17);
  const sat2 = Math.min(68, sat + 6 + pick(h, 24, 8));
  const sat3 = Math.max(42, sat - pick(h, 28, 10));

  const ligDeep = 72 + pick(h, 4, 10);
  const ligMid = 80 + pick(h, 10, 8);
  const ligGlow = 88 + pick(h, 14, 6);
  const angle = pick(h, 4, 360);

  const rx = 18 + pick(h, 10, 64);
  const ry = 12 + pick(h, 14, 55);
  const rx2 = 70 + pick(h, 20, 28);
  const ry2 = 55 + pick(h, 26, 35);

  return [
    `radial-gradient(ellipse 85% 62% at 52% 48%, hsla(${hueD},${Math.max(36, sat - 8)}%,${Math.max(60, ligMid - 10)}%,0.16) 0%, transparent 58%)`,
    `radial-gradient(ellipse 130% 100% at ${rx}% ${ry}%, hsla(${hueB},${sat2}%,${ligGlow}%,0.28) 0%, transparent 58%)`,
    `radial-gradient(ellipse 90% 70% at ${rx2}% ${ry2}%, hsla(${hueC},${sat3}%,${ligMid}%,0.22) 0%, transparent 52%)`,
    `linear-gradient(${angle}deg, hsl(${hueA},${sat}%,${ligDeep}%) 0%, hsl(${hueC},${sat3}%,${ligMid}%) 48%, hsl(${hueB},${sat2}%,${ligDeep + 4}%) 100%)`,
  ].join(",");
}
