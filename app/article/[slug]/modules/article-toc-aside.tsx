/**
 * 桌面端目录：侧栏 sticky，点击平滑滚动至对应标题锚点，高亮当前章节。
 */
import type { TocItem } from "../article-types";

export function ArticleTocAside({
  tocItems,
  activeTocId,
}: {
  tocItems: TocItem[];
  activeTocId: string;
}) {
  return (
    <aside className="hidden lg:row-span-2 lg:row-start-1 lg:block">
      <nav className="sticky top-[110px] max-h-[calc(100vh-130px)] overflow-auto pr-4">
        <ul className="space-y-1">
          {tocItems.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById(item.id);
                  if (!el) return;
                  const top = el.getBoundingClientRect().top + window.scrollY - 152;
                  window.scrollTo({ top, behavior: "smooth" });
                }}
                className={`w-full truncate border-l py-1.5 pl-3 pr-2 text-left text-sm transition ${
                  activeTocId === item.id
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800"
                }`}
                style={{ paddingLeft: `${8 + (item.level - 1) * 8}px` }}
                title={item.text}
              >
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
