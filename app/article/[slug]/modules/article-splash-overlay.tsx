/**
 * 开屏加载层：与 Playbook 一致的 SVG 路径描边进度，衔接 seal 动画后收起。
 */
import type { RefObject, TransitionEvent } from "react";
import { PlaybookSplashPaths } from "@/app/lark_growth_design_playbook/playbook-splash-paths";

export function ArticleSplashOverlay({
  splashCurveRef,
  splashHLineRef,
  splashVLineRef,
  splashStrokeLens,
  lineRatio,
  sealPhase,
  onStrokeTransitionEnd,
}: {
  splashCurveRef: RefObject<SVGPathElement | null>;
  splashHLineRef: RefObject<SVGLineElement | null>;
  splashVLineRef: RefObject<SVGLineElement | null>;
  splashStrokeLens: [number, number, number];
  lineRatio: number;
  sealPhase: boolean;
  onStrokeTransitionEnd: (e: TransitionEvent<SVGGeometryElement>) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex min-h-0 min-w-0 flex-col bg-white"
      aria-busy
      aria-live="polite"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(lineRatio * 100)}
    >
      <span className="sr-only">加载中</span>
      <div className="pointer-events-none absolute inset-0 z-0 flex min-h-0 min-w-0 flex-col">
        <PlaybookSplashPaths
          curveRef={splashCurveRef}
          hLineRef={splashHLineRef}
          vLineRef={splashVLineRef}
          lengths={splashStrokeLens}
          measured={
            splashStrokeLens[0] > 0 &&
            splashStrokeLens[1] > 0 &&
            splashStrokeLens[2] > 0
          }
          lineRatio={lineRatio}
          sealPhase={sealPhase}
          onStrokeTransitionEnd={onStrokeTransitionEnd}
        />
      </div>
    </div>
  );
}
