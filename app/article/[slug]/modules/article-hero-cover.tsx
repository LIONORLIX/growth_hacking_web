/**
 * 文章 Hero：顶栏操作、静态封面背景、标签/副标题/主标题与摘要文案。
 */
import type { RefObject } from "react";
import Link from "next/link";

type ArticleLike = {
  docsUrl?: string;
} | null;

function renderTextWithBreaks(text: string) {
  const segments = text.split("<br>");
  return segments.map((segment, index) => (
    <span key={`${segment}-${index}`}>
      {segment}
      {index < segments.length - 1 ? <br /> : null}
    </span>
  ));
}

export function ArticleHeroCover({
  titleSentinelRef,
  stickyVisible,
  article,
  coverMetaText,
  articleRecordTitle,
  articleTitle,
  articleSubtitle,
  articleSummary,
  articleBgStaticUrl,
}: {
  titleSentinelRef: RefObject<HTMLDivElement | null>;
  stickyVisible: boolean;
  article: ArticleLike;
  /** Category ｜ Region·… ｜ Tags…，已由上游拼好 */
  coverMetaText: string;
  /** 多维表记录标题（Title 字段），用于 Hero 辅线 */
  articleRecordTitle: string | null;
  articleTitle: string;
  articleSubtitle: string | null;
  articleSummary: string | null;
  articleBgStaticUrl: string | null;
}) {
  return (
    <div className="-mx-4 mb-6 overflow-hidden border-b border-gray-100 sm:-mx-6 lg:-mx-8">
      <div
        className={`fixed inset-x-0 top-0 z-[65] pt-safe transition-[opacity,transform] duration-200 ${
          stickyVisible
            ? "pointer-events-none -translate-y-2 opacity-0"
            : "translate-y-0 opacity-100"
        }`}
      >
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link
            href="/lark_growth_design_playbook"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/70 bg-white/90 text-gray-700 backdrop-blur transition hover:bg-white"
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
              className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-white/70 bg-white/90 text-gray-700 backdrop-blur transition hover:bg-white"
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
            <span className="inline-block h-11 w-11 animate-pulse rounded-md bg-white/70" />
          )}
        </div>
      </div>
      <div className="relative z-[5] flex items-center justify-center">
        <div
          className="pointer-events-none absolute inset-0 z-0"
          aria-hidden
          style={{
            backgroundColor: "#e7e5e4",
            backgroundImage: articleBgStaticUrl ? `url('${articleBgStaticUrl}')` : "none",
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            transform: "scale(1.06)",
            transformOrigin: "center",
            filter: "blur(5px)",
          }}
        />
        <div
          ref={titleSentinelRef}
          className="relative z-10 mx-auto max-w-[980px] px-4 py-14 text-center sm:px-6 sm:py-20 lg:px-8 lg:py-24"
        >
          {!article ? (
            <div className="mb-4 flex items-center justify-center gap-2">
              <span className="h-6 w-16 animate-pulse rounded-full bg-white/60" />
              <span className="h-6 w-14 animate-pulse rounded-full bg-white/60" />
              <span className="h-6 w-20 animate-pulse rounded-full bg-white/60" />
            </div>
          ) : coverMetaText.trim() ? (
            <p className="mb-3 text-center text-base font-medium tracking-wide text-white/70 sm:text-lg">
              {coverMetaText}
            </p>
          ) : null}

          {article && articleSubtitle?.trim() && articleRecordTitle?.trim() ? (
            <p className="mt-4 mb-2 text-center text-[1.08rem] font-semibold tracking-tight text-white/90 sm:text-[1.18rem]">
              {articleRecordTitle}
            </p>
          ) : null}

          <h1 className="text-[1.9rem] font-extrabold tracking-tight text-white sm:text-[2.3rem] lg:text-[2.7rem] lg:leading-[1.16]">
            {!article ? (
              <span className="mx-auto block h-10 w-2/3 animate-pulse rounded bg-white/25" />
            ) : articleSubtitle?.trim() ? (
              renderTextWithBreaks(articleSubtitle)
            ) : (
              renderTextWithBreaks(articleTitle)
            )}
          </h1>

          {article && articleSummary?.trim() ? (
            <p className="mx-auto mt-4 max-w-[660px] py-4 text-center text-[1rem] font-semibold leading-relaxed text-white/90 sm:text-[1.08rem]">
              {articleSummary}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
