"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";

const VIEW_W = 1440;
const VIEW_H = 941;
const CURVE_D =
  "M0 687.216C616 687.216 1034.5 563.216 1303.5 0.215576";
const H_X1 = 0;
const H_Y = 686.716;
const H_X2 = 1440;
const V_X = 1067.5;
const V_Y1 = 0.215576;
const V_Y2 = 940.216;

/**
 * 用户调参（整段 LOOP 含移动 + 收尾 + 留白，避免到终点立刻跳回起点）：
 * - LOOP_MS / PHASE_PATH / TRAIL_LEN_PX / RIBBON_SEGMENTS / STROKE_W
 * - CYCLE_*：单条路径在一个 LOOP 内的时间占比，需和为 1
 */
const LOOP_MS = [15_000, 14_000, 16_000] as const;
const PHASE_PATH = [0, 0.58, 4.91] as const;
const TRAIL_LEN_PX = [560, 560, 560] as const;
const RIBBON_SEGMENTS = [56, 10, 40] as const;
const STROKE_W = [0.5, 0.5, 0.5] as const;

/** 头端从起点扫到终点；拖尾整体从终点「滑出」；最后留白再开下一轮 */
const CYCLE_MOVE_FRAC = [0.52, 0.52, 0.52] as const;
const CYCLE_EXIT_FRAC = [0.34, 0.34, 0.34] as const;
const CYCLE_PAUSE_FRAC = [0.14, 0.14, 0.14] as const;

type PlaybookFullscreenPathTracersProps = {
  active: boolean;
  motionPaused: boolean;
  reduceMotion: boolean;
};

function ribbonDRange(
  el: SVGGeometryElement,
  len: number,
  d0: number,
  d1: number,
  segments: number,
): string {
  const lo = Math.max(0, Math.min(d0, len));
  const hi = Math.max(0, Math.min(d1, len));
  if (len <= 0 || hi <= lo + 1e-4) return "";
  const parts: string[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const dist = lo + (hi - lo) * u;
    const { x, y } = el.getPointAtLength(dist);
    parts.push(i === 0 ? `M${x},${y}` : `L${x},${y}`);
  }
  return parts.join(" ");
}

function cycleRibbonRange(
  len: number,
  trailLen: number,
  t01: number,
  moveF: number,
  exitF: number,
  pauseF: number,
): { d0: number; d1: number; visible: boolean; trailOpacity: number } {
  const sum = moveF + exitF + pauseF;
  const m = moveF / sum;
  const x = exitF / sum;
  const pa = pauseF / sum;

  if (t01 < m) {
    const u = t01 / m;
    const d1 = u * len;
    const d0 = Math.max(0, d1 - trailLen);
    return { d0, d1, visible: true, trailOpacity: 1 };
  }
  if (t01 < m + x) {
    const u = (t01 - m) / x;
    const d1 = len;
    const span = Math.min(trailLen, len);
    const d0 = Math.max(0, len - span) + u * span;
    const trailOpacity =
      u > 0.82 ? 1 - (u - 0.82) / (1 - 0.82) * 0.45 : 1;
    return { d0, d1, visible: true, trailOpacity };
  }
  return { d0: 0, d1: 0, visible: false, trailOpacity: 0 };
}

/** 全屏 Hero：沿三条路径的连续渐变拖尾 + 角落数字（周期末留白、拖尾滑出终点） */
export function PlaybookFullscreenPathTracers({
  active,
  motionPaused,
  reduceMotion,
}: PlaybookFullscreenPathTracersProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const filterId = `pfpt-blur-${uid}`;
  const gid = (i: number) => `pfpt-ribbon-${uid}-${i}`;

  const curveGeomRef = useRef<SVGPathElement | null>(null);
  const hGeomRef = useRef<SVGLineElement | null>(null);
  const vGeomRef = useRef<SVGLineElement | null>(null);
  const trailPathRefs = useRef<(SVGPathElement | null)[]>([null, null, null]);
  const gradRefs = useRef<(SVGLinearGradientElement | null)[]>([
    null,
    null,
    null,
  ]);
  const lensRef = useRef<[number, number, number]>([0, 0, 0]);
  const numberRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef(0);

  const measure = () => {
    const c = curveGeomRef.current?.getTotalLength() ?? 0;
    const h = hGeomRef.current?.getTotalLength() ?? 0;
    const v = vGeomRef.current?.getTotalLength() ?? 0;
    if (c > 0 && h > 0 && v > 0) {
      lensRef.current = [c, h, v];
    }
  };

  useLayoutEffect(() => {
    if (!active) return;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);

  useEffect(() => {
    if (!active || motionPaused || reduceMotion) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    const curve = curveGeomRef.current;
    const hLine = hGeomRef.current;
    const vLine = vGeomRef.current;
    const trails = trailPathRefs.current;
    const grads = gradRefs.current;

    const tick = () => {
      if (!curve || !hLine || !vLine) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const now = performance.now();
      const [lc, lh, lv] = lensRef.current;
      const geoms: [SVGGeometryElement, number][] = [
        [curve, lc],
        [hLine, lh],
        [vLine, lv],
      ];

      for (let p = 0; p < 3; p++) {
        const trail = trails[p];
        const grad = grads[p];
        const [el, len] = geoms[p]!;
        if (!trail || !grad || len <= 0) continue;

        const loop = LOOP_MS[p]!;
        const t01 = (((now / loop + PHASE_PATH[p]!) % 1) + 1) % 1;
        const trailLen = Math.min(TRAIL_LEN_PX[p]!, len * 0.98);
        const seg = RIBBON_SEGMENTS[p]!;
        const { d0, d1, visible, trailOpacity } = cycleRibbonRange(
          len,
          trailLen,
          t01,
          CYCLE_MOVE_FRAC[p]!,
          CYCLE_EXIT_FRAC[p]!,
          CYCLE_PAUSE_FRAC[p]!,
        );

        if (!visible) {
          trail.setAttribute("opacity", "0");
          continue;
        }

        const d = ribbonDRange(el, len, d0, d1, seg);
        if (!d) {
          trail.setAttribute("opacity", "0");
          continue;
        }

        trail.setAttribute("d", d);
        trail.setAttribute("opacity", String(trailOpacity));

        const tail = el.getPointAtLength(d0);
        const head = el.getPointAtLength(d1);
        grad.setAttribute("x1", String(tail.x));
        grad.setAttribute("y1", String(tail.y));
        grad.setAttribute("x2", String(head.x));
        grad.setAttribute("y2", String(head.y));
      }

      if (numberRef.current) {
        const n = Math.floor(now / 280) % 1000;
        numberRef.current.textContent = String(n).padStart(3, "0");
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, motionPaused, reduceMotion]);

  if (!active || reduceMotion) return null;

  const setTrailRef = (i: number) => (el: SVGPathElement | null) => {
    trailPathRefs.current[i] = el;
  };
  const setGradRef = (i: number) => (el: SVGLinearGradientElement | null) => {
    gradRefs.current[i] = el;
  };

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[6] flex min-h-0 min-w-0 flex-col"
      aria-hidden
    >
      <svg
        className="block h-full min-h-0 w-full min-w-0 flex-1"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
      >
        <defs>
          <filter
            id={filterId}
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.1" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {[0, 1, 2].map((i) => (
            <linearGradient
              key={i}
              id={gid(i)}
              ref={setGradRef(i)}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="42%" stopColor="#ffffff" stopOpacity="0.22" />
              <stop offset="78%" stopColor="#ffffff" stopOpacity="0.62" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.96" />
            </linearGradient>
          ))}
        </defs>

        <path
          ref={curveGeomRef}
          d={CURVE_D}
          fill="none"
          stroke="none"
          strokeWidth={0}
        />
        <line
          ref={hGeomRef}
          x1={H_X1}
          y1={H_Y}
          x2={H_X2}
          y2={H_Y}
          stroke="none"
          strokeWidth={0}
        />
        <line
          ref={vGeomRef}
          x1={V_X}
          y1={V_Y1}
          x2={V_X}
          y2={V_Y2}
          stroke="none"
          strokeWidth={0}
        />

        {/* 加载结束后保留的静态线：与首屏加载同源，半透明白 */}
        <g fill="none" stroke="#ffffff" strokeOpacity={0.28}>
          <path
            d={CURVE_D}
            strokeWidth={0.5}
            strokeLinecap="butt"
            strokeLinejoin="miter"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={H_X1}
            y1={H_Y}
            x2={H_X2}
            y2={H_Y}
            strokeWidth={0.5}
            strokeLinecap="butt"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={V_X}
            y1={V_Y1}
            x2={V_X}
            y2={V_Y2}
            strokeWidth={0.5}
            strokeLinecap="butt"
            vectorEffect="non-scaling-stroke"
          />
        </g>

        <g filter={`url(#${filterId})`}>
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              ref={setTrailRef(i)}
              fill="none"
              stroke={`url(#${gid(i)})`}
              strokeWidth={STROKE_W[i]}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity={0}
            />
          ))}
        </g>
      </svg>
      <div className="absolute bottom-6 right-7 sm:bottom-8 sm:right-10">
        <span
          ref={numberRef}
          className="font-mono text-[11px] tabular-nums tracking-[0.2em] text-white/85 sm:text-xs"
          style={{
            textShadow:
              "0 0 12px rgba(255,255,255,0.45), 0 0 28px rgba(255,255,255,0.2)",
          }}
        >
          000
        </span>
      </div>
    </div>
  );
}
