/**
 * Hydration 前占位整页：避免首屏闪动，展示与真实布局接近的灰块骨架。
 */
export function ArticleSsrFallback({ bgShader }: { bgShader: string }) {
  return (
    <div className="relative min-h-screen bg-white pb-16">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage: bgShader,
          backgroundColor: "#ffffff",
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
          backgroundPosition: "center center",
        }}
      />
      <div className="relative w-full px-5 sm:px-8 lg:px-10">
        <article>
          <div className="mx-auto mb-10 flex max-w-[760px] items-center justify-between">
            <span className="inline-block h-10 w-10 animate-pulse rounded-full bg-gray-100" />
            <span className="inline-block h-8 w-8 animate-pulse rounded-md bg-gray-100" />
          </div>
          <header className="mx-auto mb-6 max-w-[760px] border-b border-gray-200 pb-5">
            <h1 className="mt-8 text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
              <span className="block h-10 w-2/3 animate-pulse rounded bg-gray-200" />
            </h1>
          </header>
        </article>
      </div>
    </div>
  );
}
