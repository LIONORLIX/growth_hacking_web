/**
 * 文章页页脚：版权与一句说明文案。
 */
export function ArticlePageFooter() {
  return (
    <footer className="mt-14 border-t border-gray-200">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col items-start gap-2 px-4 py-6 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 lg:px-8">
        <p>© {new Date().getFullYear()} Lark Growth Design Playbook</p>
        <p>Built for growth stories and design insights.</p>
      </div>
    </footer>
  );
}
