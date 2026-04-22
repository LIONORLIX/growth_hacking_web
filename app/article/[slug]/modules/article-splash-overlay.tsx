"use client";

export function ArticleSplashOverlay() {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-white"
      aria-busy
      aria-live="polite"
    >
      <span className="sr-only">加载中</span>
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-stone-200 border-t-stone-900" />
    </div>
  );
}
