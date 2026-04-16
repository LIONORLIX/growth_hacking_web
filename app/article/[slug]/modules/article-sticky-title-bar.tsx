/**
 * 吸顶标题栏：滚动过 Hero 后固定在顶部，含返回 Playbook 与打开飞书文档。
 */
import Link from "next/link";

export function ArticleStickyTitleBar({
  visible,
  articleTitle,
  docsUrl,
}: {
  visible: boolean;
  articleTitle: string;
  docsUrl?: string;
}) {
  return (
    <div
      className={`fixed inset-x-0 top-0 z-[70] border-b bg-white transition-[opacity,transform] duration-200 ${
        visible
          ? "translate-y-0 opacity-100 border-gray-200"
          : "pointer-events-none -translate-y-full opacity-0 border-transparent"
      }`}
    >
      <div className="mx-auto flex w-full max-w-[1120px] items-center gap-3 py-3">
        <Link
          href="/lark_growth_design_playbook"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
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
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{articleTitle}</p>
        </div>
        {docsUrl ? (
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="打开原始飞书文档"
            title="打开原始飞书文档"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-200 text-gray-500 transition hover:bg-gray-50 hover:text-blue-600"
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
          <span className="inline-block h-8 w-8 shrink-0 animate-pulse rounded-md bg-gray-100" />
        )}
      </div>
    </div>
  );
}
