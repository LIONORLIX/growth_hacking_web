/**
 * 文章 Hero：顶栏操作、参数化 shader 背景、标签/副标题/主标题与摘要文案。
 */
import type { RefObject } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

const PlaybookHeroShaderBackground = dynamic(
  () => import("@/app/lark_growth_design_playbook/playbook-hero-shader-bg"),
  { ssr: false }
);

type ArticleLike = {
  docsUrl?: string;
} | null;

export function ArticleHeroCover({
  titleSentinelRef,
  stickyVisible,
  article,
  coverMetaText,
  articleTitle,
  articleSubtitle,
  articleSummary,
  articleCoverSeed,
  articleThemeHex,
  articleThemeAccentHexes,
}: {
  titleSentinelRef: RefObject<HTMLDivElement | null>;
  stickyVisible: boolean;
  article: ArticleLike;
  /** Category ｜ Region·… ｜ Tags…，已由上游拼好 */
  coverMetaText: string;
  articleTitle: string;
  articleSubtitle: string | null;
  articleSummary: string | null;
  articleCoverSeed: string;
  articleThemeHex: string | null;
  articleThemeAccentHexes: string[];
}) {
  return (
    <div className="-mx-5 mb-6 overflow-hidden border-b border-gray-100 sm:-mx-8 lg:-mx-10">
      <div
        className={`fixed inset-x-0 top-0 z-[65] transition-[opacity,transform] duration-200 ${
          stickyVisible
            ? "pointer-events-none -translate-y-2 opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between py-4">
          <Link
            href="/lark_growth_design_playbook"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-white/90 text-gray-700 backdrop-blur transition hover:bg-white"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </Link>
          {article?.docsUrl ? (
            <a
              href={article.docsUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="打开原始飞书文档"
              title="打开原始飞书文档"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/70 bg-white/90 text-gray-700 backdrop-blur transition hover:bg-white"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M14 3h7v7" />
                <path d="M10 14L21 3" />
                <path d="M21 14v7h-7" />
                <path d="M3 10v11h11" />
              </svg>
            </a>
          ) : (
            <span className="inline-block h-8 w-8 animate-pulse rounded-md bg-white/70" />
          )}
        </div>
      </div>
      <div className="relative z-[5] flex items-center justify-center">
        <PlaybookHeroShaderBackground
          seed={articleCoverSeed}
          themeBaseHex={articleThemeHex}
          themeAccentHexes={articleThemeAccentHexes}
          variant="hero"
          motionPaused={false}
        />
        <div
          ref={titleSentinelRef}
          className="relative z-10 mx-auto max-w-[960px] px-5 py-20 text-center sm:px-8 sm:py-28 lg:py-45"
        >
          {!article ? (
            <div className="mb-4 flex items-center justify-center gap-2">
              <span className="h-6 w-16 animate-pulse rounded-full bg-white/60" />
              <span className="h-6 w-14 animate-pulse rounded-full bg-white/60" />
              <span className="h-6 w-20 animate-pulse rounded-full bg-white/60" />
            </div>
          ) : coverMetaText.trim() ? (
            <p className="mb-3 text-center text-base font-medium tracking-wide text-white/70">
              {coverMetaText}
            </p>
          ) : null}

          {article && articleSubtitle?.trim() && articleTitle ? (
            <p className="mt-6 mb-3 text-center text-base font-semibold tracking-tight text-white/90">
              {articleTitle}
            </p>
          ) : null}

          <h1 className="text-5xl font-extrabold tracking-tight text-white lg:text-[3rem] lg:leading-[1.15]">
            {!article ? (
              <span className="mx-auto block h-10 w-2/3 animate-pulse rounded bg-white/25" />
            ) : articleSubtitle?.trim() ? (
              articleSubtitle
            ) : (
              articleTitle
            )}
          </h1>

          {article && articleSummary?.trim() ? (
            <p className="mx-auto mt-6 max-w-[700px] py-6 text-center text-xl font-semibold leading-relaxed text-white/90">
              {articleSummary}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
