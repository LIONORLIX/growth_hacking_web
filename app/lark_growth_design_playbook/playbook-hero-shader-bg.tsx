"use client";

import p5 from "p5";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { heightmapRampFrag, heightmapRampVert } from "./heightmap-ramp-shaders";
import { heroHeightmapNoiseOrigin, heroHeightmapRampPixels } from "@/lib/hero-heightmap-ramp";
import { getHeroParametricGradient } from "@/lib/hero-parametric-gradient";

/* =============================================================================
 * Hero 高度图 WebGL 背景 — 可调参数（改这里即可）
 * -----------------------------------------------------------------------------
 * 动效：噪声域「波动」（域扭曲 sin/cos），非整幅匀速平移
 * 色标 stop：lib/hero-heightmap-ramp.ts 内 heroHeightmapStopsFromSeed
 * 合成柔化：下方 JSX 中 blur-[clamp(...)] + contrast / saturate
 * 视口门控：variant=card 时仍可用（列表 grid 已改 CSS 缩略图，本页仅 Hero 走 WebGL）
 * Hero：不叠 CSS 渐变底；全屏/卡片在 page 中共用单一 WebGL 实例
 * ============================================================================= */
type HeightmapBgConfig = {
  rampWidth: number;
  rampSmoothSpread: number;
  pixelDensity: number;
  noiseScale: number;
  timeScale: number;
  waveAmplitude: number;
  waveOmega: readonly [number, number];
  waveSpatial: readonly [number, number, number, number];
  waveSecondary: number;
  grain: number;
  overlayNoiseOpacity: number;
};

/** 1D 色标宽 / 模糊采样 / pixelDensity / 噪声与波动等，见上方注释块 */
const HERO_HEIGHTMAP_BG: HeightmapBgConfig = {
  rampWidth: 640,
  rampSmoothSpread: 2.0,
  pixelDensity: 1.2,
  noiseScale: 0.3,
  timeScale: 0.00012,
  waveAmplitude: 0.2,
  waveOmega: [1.08, 0.92],
  waveSpatial: [2.15, 1.65, 1.9, 2.28],
  waveSecondary: 0.48,
  grain: 0.03,
  overlayNoiseOpacity: 0.14,
};

/** 列表卡片缩略图：略降分辨率/模糊，减轻多 WebGL 实例压力 */
const CARD_HEIGHTMAP_BG: HeightmapBgConfig = {
  ...HERO_HEIGHTMAP_BG,
  rampWidth: 384,
  rampSmoothSpread: 1.75,
  pixelDensity: 1,
  overlayNoiseOpacity: 0.08,
};

function heightmapConfigForVariant(variant: "hero" | "card"): HeightmapBgConfig {
  return variant === "card" ? CARD_HEIGHTMAP_BG : HERO_HEIGHTMAP_BG;
}

/** 列表卡片：IntersectionObserver 预取的 rootMargin */
const CARD_VIEWPORT_ROOT_MARGIN = "220px 0px 320px 0px";
/** 从未 intersect 过时，延迟标为不可见（避免首帧闪）；一旦进过视口即粘住 WebGL，不再走卸载 */
const CARD_VIEWPORT_UNMOUNT_MS = 1400;

const MOUNT_RAF_MAX_ATTEMPTS = 120;
const CONTEXT_LOST_REMOUNT_DEBOUNCE_MS = 450;

/** 与 IntersectionObserver 的 rootMargin 竖直方向一致（如 `220px 0px 320px 0px`） */
function verticalRootMarginPx(margin: string): { top: number; bottom: number } {
  const parts = margin.trim().split(/\s+/);
  if (parts.length >= 3) {
    return {
      top: Number.parseInt(parts[0]!, 10) || 0,
      bottom: Number.parseInt(parts[2]!, 10) || 0,
    };
  }
  return { top: 220, bottom: 320 };
}

type P5Instance = InstanceType<typeof p5>;

/** @types/p5 未稳定暴露 Shader 类，这里只约束本组件用到的接口 */
type P5ShaderUniforms = {
  setUniform(name: string, data: number | number[] | boolean | object): void;
};

type P5GraphicsPixels = {
  pixels: number[] | Uint8ClampedArray;
  loadPixels(): void;
  updatePixels(): void;
};

function buildRampGraphics(
  p: P5Instance,
  seed: string,
  rampWidth: number,
  themeBaseHex?: string | null,
  themeAccentHexes: string[] = [],
): P5GraphicsPixels {
  const g = p.createGraphics(rampWidth, 1);
  g.pixelDensity(1);
  const px = heroHeightmapRampPixels(seed, rampWidth, themeBaseHex, themeAccentHexes);
  g.loadPixels();
  for (let i = 0; i < px.length; i += 1) {
    g.pixels[i] = px[i];
  }
  g.updatePixels();
  return g;
}

/**
 * p5.js WEBGL：Simplex FBM 作高度图 + CPU 生成的多 stop 色标纹理采样。
 * 与「噪声场 → [0,1] → 色标查找」的 ramp 映射一致。
 */
type PlaybookHeroShaderBackgroundProps = {
  seed: string;
  /** 多维表 `theme` 解析出的基准色（#RRGGBB）；有则 shader / 降级 CSS 渐变以此色相为轴 */
  themeBaseHex?: string | null;
  /** 多维表 `theme` 解析出的辅助色；用于扩展色标但仍保留 seed 生成的额外层次 */
  themeAccentHexes?: string[];
  /** 卡片态下冻结波动（时间不前进），减轻 GPU 与小窗动效 */
  motionPaused?: boolean;
  /** 是否应用柔化（blur/contrast/saturate）；默认 true */
  soften?: boolean;
  /** hero：全屏/Header；card：列表卡片缩略图（更省 GPU） */
  variant?: "hero" | "card";
  /**
   * true：未进视口时可仅用 CSS 占位；进视口后挂载 WebGL 并保持（不因滚动误卸载）。
   * 不传时：card 默认为 true，hero 为 false。
   */
  viewportGate?: boolean;
  /** IntersectionObserver 的 rootMargin，控制提前多远开始挂载 */
  viewportRootMargin?: string;
  /** 离开视口后延迟多久卸载 WebGL，避免边缘来回抖动 */
  viewportUnmountMs?: number;
};

export default function PlaybookHeroShaderBackground({
  seed,
  themeBaseHex = null,
  themeAccentHexes = [],
  motionPaused = false,
  soften = true,
  variant = "hero",
  viewportGate: viewportGateProp,
  viewportRootMargin = CARD_VIEWPORT_ROOT_MARGIN,
  viewportUnmountMs = CARD_VIEWPORT_UNMOUNT_MS,
}: PlaybookHeroShaderBackgroundProps) {
  const gateRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const motionPausedRef = useRef(motionPaused);

  const viewportGate = useMemo(
    () => viewportGateProp ?? variant === "card",
    [viewportGateProp, variant],
  );

  /** 仅 viewportGate 为 true 时使用；false 表示尚未进入观察区域 */
  const [inView, setInView] = useState(false);
  /** 列表卡片：任意一次 intersect / 同步几何命中后即 true，之后不再因 IO 离开而关 WebGL */
  const gateEverVisibleRef = useRef(false);
  const webglActive = !viewportGate || inView;
  /** WebGL 上下文被系统回收后强制重建 p5（否则画布长期空白） */
  const [glRemountKey, setGlRemountKey] = useState(0);

  useEffect(() => {
    motionPausedRef.current = motionPaused;
  }, [motionPaused]);

  useEffect(() => {
    if (!viewportGate) return undefined;
    const el = gateRef.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      queueMicrotask(() => setInView(true));
      return undefined;
    }
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const clearHide = () => {
      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    };
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          clearHide();
          gateEverVisibleRef.current = true;
          setInView(true);
        } else {
          clearHide();
          if (!gateEverVisibleRef.current) {
            hideTimer = setTimeout(() => setInView(false), viewportUnmountMs);
          }
        }
      },
      { root: null, rootMargin: viewportRootMargin, threshold: 0 },
    );
    obs.observe(el);
    return () => {
      clearHide();
      obs.disconnect();
    };
  }, [viewportGate, viewportRootMargin, viewportUnmountMs]);

  /** IO 首帧异步：已在视口内的卡片同步标为可见，避免长期停在 CSS 降级层 */
  useLayoutEffect(() => {
    if (!viewportGate) return;
    const el = gateRef.current;
    if (!el) return;
    const rootH = typeof window !== "undefined" ? window.innerHeight : 0;
    const rootW = typeof window !== "undefined" ? window.innerWidth : 0;
    if (rootH <= 0 || rootW <= 0) return;
    const { top: marginTop, bottom: marginBottom } = verticalRootMarginPx(viewportRootMargin);
    const rect = el.getBoundingClientRect();
    const expandedTop = -marginTop;
    const expandedBottom = rootH + marginBottom;
    const intersects =
      rect.bottom > expandedTop && rect.top < expandedBottom && rect.right > 0 && rect.left < rootW;
    if (intersects) {
      gateEverVisibleRef.current = true;
      queueMicrotask(() => setInView(true));
    }
  }, [viewportGate, viewportRootMargin, seed, variant]);

  useLayoutEffect(() => {
    if (!webglActive) return undefined;

    let cancelled = false;
    let instance: P5Instance | null = null;
    let ro: ResizeObserver | null = null;
    let sizeKickObs: ResizeObserver | null = null;
    let rafId = 0;
    let canvas: HTMLCanvasElement | null = null;
    let lastContextLostRemountAt = 0;

    const onContextLost = (e: Event) => {
      e.preventDefault();
      if (cancelled) return;
      const now = performance.now();
      if (now - lastContextLostRemountAt < CONTEXT_LOST_REMOUNT_DEBOUNCE_MS) return;
      lastContextLostRemountAt = now;
      setGlRemountKey((k) => k + 1);
    };

    const cfg = heightmapConfigForVariant(variant);
    const [noiseOx, noiseOy] = heroHeightmapNoiseOrigin(seed);
    const rampDu = cfg.rampSmoothSpread / cfg.rampWidth;

    const tryMount = (attempt: number) => {
      if (cancelled || instance) return;
      const host = hostRef.current;
      if (host && !sizeKickObs) {
        sizeKickObs = new ResizeObserver(() => {
          if (cancelled || instance) return;
          const h = hostRef.current;
          if (!h || h.clientWidth < 2 || h.clientHeight < 2) return;
          tryMount(0);
        });
        sizeKickObs.observe(host);
      }
      if (!host) {
        if (attempt < MOUNT_RAF_MAX_ATTEMPTS) {
          rafId = requestAnimationFrame(() => tryMount(attempt + 1));
        }
        return;
      }
      const cw = host.clientWidth;
      const ch = host.clientHeight;
      if (cw < 2 || ch < 2) {
        if (attempt < MOUNT_RAF_MAX_ATTEMPTS) {
          rafId = requestAnimationFrame(() => tryMount(attempt + 1));
        }
        return;
      }

      const sketch = (p: P5Instance) => {
        let bgShader: P5ShaderUniforms;
        let ramp: P5GraphicsPixels;
        /** 与暂停前 uFlow.z 连续：暂停时冻结该值，解除暂停时用锚点接上 millis */
        let flowTAnchorMillis = 0;
        let frozenFlowT = 0;
        let prevPaused: boolean | null = null;

        p.setup = () => {
          const w = Math.max(1, host.clientWidth);
          const h = Math.max(1, host.clientHeight);
          p.createCanvas(w, h, p.WEBGL);
          p.pixelDensity(cfg.pixelDensity);
          p.noStroke();

          ramp = buildRampGraphics(p, seed, cfg.rampWidth, themeBaseHex, themeAccentHexes);
          bgShader = p.createShader(heightmapRampVert, heightmapRampFrag) as P5ShaderUniforms;
        };

        p.draw = () => {
          const paused = motionPausedRef.current;
          const millis = p.millis();
          const ts = cfg.timeScale;

          if (prevPaused === null) {
            prevPaused = paused;
            flowTAnchorMillis = millis;
            frozenFlowT = 0;
          } else if (paused !== prevPaused) {
            if (paused) {
              frozenFlowT = (millis - flowTAnchorMillis) * ts;
            } else {
              flowTAnchorMillis = millis - frozenFlowT / ts;
            }
            prevPaused = paused;
          }

          const t = paused ? frozenFlowT : (millis - flowTAnchorMillis) * ts;

          p.shader(bgShader as never);
          bgShader.setUniform("uRampTex", ramp);
          bgShader.setUniform("uResolution", [p.width, p.height]);
          bgShader.setUniform("uFlow", [noiseOx, noiseOy, t]);
          bgShader.setUniform("uWaveAmp", cfg.waveAmplitude);
          bgShader.setUniform("uWaveOmega", [...cfg.waveOmega]);
          bgShader.setUniform("uWaveSpatial", [...cfg.waveSpatial]);
          bgShader.setUniform("uWaveSecondary", cfg.waveSecondary);
          bgShader.setUniform("uNoiseScale", cfg.noiseScale);
          bgShader.setUniform("uGrain", cfg.grain);
          bgShader.setUniform("uRampDu", rampDu);
          p.plane(p.width, p.height);
        };
      };

      instance = new p5(sketch, host);
      canvas = host.querySelector("canvas");
      canvas?.addEventListener("webglcontextlost", onContextLost);

      ro = new ResizeObserver(() => {
        if (!instance) return;
        const w = Math.max(1, host.clientWidth);
        const h = Math.max(1, host.clientHeight);
        instance.resizeCanvas(w, h);
      });
      ro.observe(host);
    };

    tryMount(0);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      canvas?.removeEventListener("webglcontextlost", onContextLost);
      ro?.disconnect();
      sizeKickObs?.disconnect();
      instance?.remove();
      instance = null;
      canvas = null;
      ro = null;
      sizeKickObs = null;
    };
  }, [seed, themeBaseHex, themeAccentHexes, variant, webglActive, glRemountKey]);

  const cfg = heightmapConfigForVariant(variant);
  const blurShellClass = soften
    ? variant === "card"
      ? "pointer-events-none absolute -inset-[10%] z-[1] h-[120%] w-[120%] origin-center blur-[10px] contrast-[0.97] saturate-[1.02]"
      : "pointer-events-none absolute -inset-[14%] z-[1] h-[128%] w-[128%] origin-center blur-[clamp(14px,3.2vw,28px)] contrast-[0.96] saturate-[1.02]"
    : "pointer-events-none absolute inset-0 z-[1] h-full w-full";

  return (
    <div ref={gateRef} className="pointer-events-none absolute inset-0 z-[1] overflow-hidden opacity-100">
      {viewportGate && !webglActive ? (
        <div
          className="absolute inset-0 z-0"
          style={{ background: getHeroParametricGradient(seed, themeBaseHex, themeAccentHexes) }}
          aria-hidden
        />
      ) : null}

      {webglActive ? (
        <>
          {/*
            合成柔化：blur / contrast / saturate（card 用较弱模糊）
          */}
          <div className={blurShellClass} aria-hidden>
            <div
              ref={hostRef}
              className="pointer-events-none h-full w-full touch-none [&_canvas]:block [&_canvas]:h-full [&_canvas]:w-full"
            />
          </div>
          <div
            className="pointer-events-none absolute inset-0 z-[2] mix-blend-overlay"
            aria-hidden
            style={{
              opacity: cfg.overlayNoiseOpacity,
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            }}
          />
        </>
      ) : null}
    </div>
  );
}
