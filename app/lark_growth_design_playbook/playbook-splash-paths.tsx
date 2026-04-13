"use client";

import type { RefObject, TransitionEvent } from "react";

type PlaybookSplashPathsProps = {
  curveRef: RefObject<SVGPathElement | null>;
  hLineRef: RefObject<SVGLineElement | null>;
  vLineRef: RefObject<SVGLineElement | null>;
  lengths: readonly [number, number, number];
  measured: boolean;
  lineRatio: number;
  sealPhase: boolean;
  onStrokeTransitionEnd: (e: TransitionEvent<SVGGeometryElement>) => void;
};

/** 与 `public/playbook-load-paths.svg` 同源：三条线同步按 stroke-dashoffset 从 0% 画到 100% */
export function PlaybookSplashPaths({
  curveRef,
  hLineRef,
  vLineRef,
  lengths,
  measured,
  lineRatio,
  sealPhase,
  onStrokeTransitionEnd,
}: PlaybookSplashPathsProps) {
  const dash = (len: number) =>
    measured && len > 0 ? `${len} ${len}` : "0 1";
  const off = (len: number) => (measured && len > 0 ? len * (1 - lineRatio) : 0);
  const dashStyle = {
    transition: sealPhase
      ? ("stroke-dashoffset 0.78s cubic-bezier(0.33, 1, 0.68, 1)" as const)
      : ("none" as const),
  };
  const [lenCurve, lenH, lenV] = lengths;
  const vis = measured && lenCurve > 0 && lenH > 0 && lenV > 0 ? 1 : 0;

  return (
    <svg
      className="block h-full min-h-0 w-full min-w-0 flex-1 text-stone-900"
      viewBox="0 0 1440 941"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden
    >
      <path
        ref={curveRef}
        d="M0 687.216C616 687.216 1034.5 563.216 1303.5 0.215576"
        stroke="currentColor"
        strokeWidth="0.5"
        fill="none"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        strokeOpacity={vis}
        strokeDasharray={dash(lenCurve)}
        strokeDashoffset={off(lenCurve)}
        style={dashStyle}
        onTransitionEnd={onStrokeTransitionEnd}
      />
      <line
        ref={hLineRef}
        x1="0"
        y1="686.716"
        x2="1440"
        y2="686.716"
        stroke="currentColor"
        strokeWidth="0.5"
        strokeLinecap="butt"
        strokeOpacity={vis}
        strokeDasharray={dash(lenH)}
        strokeDashoffset={off(lenH)}
        style={dashStyle}
        onTransitionEnd={onStrokeTransitionEnd}
      />
      <line
        ref={vLineRef}
        x1="1067.5"
        y1="0.215576"
        x2="1067.5"
        y2="940.216"
        stroke="currentColor"
        strokeWidth="0.5"
        strokeLinecap="butt"
        strokeOpacity={vis}
        strokeDasharray={dash(lenV)}
        strokeDashoffset={off(lenV)}
        style={dashStyle}
        onTransitionEnd={onStrokeTransitionEnd}
      />
    </svg>
  );
}
