# AI 维护指南（站点结构与调优入口）

本文档面向 AI/自动化助手，目标是帮助快速理解项目结构、数据流和高频改动位置，减少“盲改”。

## 1. 项目定位

- 技术栈：`Next.js 16 (App Router) + React 19 + TypeScript + Tailwind + CSS Modules`
- 站点核心页面：
  - `app/lark_growth_design_playbook/page.tsx`：文章列表/封面动画页（主入口）
  - `app/article/[slug]/page.tsx`：文章详情页（流式加载、目录、正文模块化渲染）
- 首页重定向：`app/page.tsx` 会直接跳到 `"/lark_growth_design_playbook"`。

## 2. 顶层目录速览

- `app/`：页面与 API Route（核心）
- `lib/feishu/`：飞书 API 客户端、鉴权
- `lib/playbook-data-source.ts`：Playbook 使用的 app/table token 来源与 debug 开关
- `lib/hero-*.ts`：封面渐变/高度图相关算法
- `public/`：静态资源

## 3. 路由与页面职责

### 3.1 Playbook 列表页

- 文件：`app/lark_growth_design_playbook/page.tsx`
- 职责：
  - 拉取已发布记录（`/api/playbook`）
  - 卡片封面图/动态媒体
  - Hero 与 splash 动画
  - 跳转文章详情页

### 3.2 文章详情页

- 文件：`app/article/[slug]/page.tsx`
- 职责：
  - 先查记录（`/api/playbook?slug=...`），再流式拉正文（`/api/article?...&stream=1`）
  - 管理 splash、sticky title、TOC 高亮
  - 装配正文渲染模块（`modules/*`）
  - 错误态空白页（`modules/article-error-state.tsx`）

## 4. API 数据流（飞书）

## 4.1 `/api/playbook`

- 文件：`app/api/playbook/route.ts`
- 返回多维表记录（仅 `Status=pub`）
- 支持按 `slug` / `recordId` 精确查找

## 4.2 `/api/article`

- 文件：`app/api/article/route.ts`
- 核心流程：
  1. 解析文档 ID（debug 或从多维表字段提取）
  2. 拉取/流式拉取 docx block
  3. 标准化为前端消费的 `blocks`
  4. 返回 partial/complete 流消息
- 缓存：内存缓存 `ARTICLE_CACHE_SCHEMA_VERSION`（改结构时请升级版本号）
- 当前已处理：
  - 标题级别
  - grid 列宽比例（`width_ratio`）
  - table 合并信息（`merge_info`）

## 4.3 媒体代理

- `app/api/feishu-image/route.ts`：图片/视频 token 代理（含 range 支持）
- `app/api/feishu-board-image/route.ts`：画板快照代理

## 5. 文章详情页模块地图（高频改动）

目录：`app/article/[slug]/modules/`

- 布局壳：
  - `article-splash-overlay.tsx`：开屏进度
  - `article-sticky-title-bar.tsx`：顶部吸附栏
  - `article-hero-cover.tsx`：头图区
  - `article-toc-aside.tsx`：侧栏目录
  - `article-page-footer.tsx`：页脚
- 正文：
  - `article-content.tsx`：主渲染入口（块类型分发）
  - `article-markdown.tsx`：markdown/fallback 解析与基础渲染函数
  - `article-prose.module.css`：正文主样式（标题、表格、callout、列表）
- 媒体：
  - `article-lazy-image.tsx` + `article-image-lightbox.tsx`
- 状态：
  - `article-body-preview-skeleton.tsx`
  - `article-stream-footer.tsx`
  - `article-error-state.tsx`

## 6. 标题、目录、编号规则

- 文件：
  - `article-heading.ts`：标题文本归一化、锚点 ID
  - `article-heading-level-map.ts`：相对层级映射、目录级别限制、标题自动编号
- 要点：
  - 标题样式不再严格按原文 `heading1~6` 直映射，而是按“本文出现过的层级集合”做相对映射
  - 目录只显示到 `TOC_MAX_DISPLAY_LEVEL`（当前为 2）
  - 一级/二级标题可自动编号

## 7. 表格与分栏（最容易出问题）

- 分栏比例：
  - API 层提取 `grid_column.width_ratio`
  - 前端按比例生成 `grid-template-columns`
- 表格合并：
  - API 层输出 `tableCellMerge`（来自 `table.property.merge_info`）
  - 前端 `applyTableCellMergeToGrid` 应用 `row_span/col_span`
- 经验规则：
  - 如果表格“错位”，先检查 API 侧 `cells` 顺序和 `column_size`
  - 如果“没合并”，先检查 `merge_info` 长度是否与单元格数量一致

## 8. 环境变量与调试

- 主要开关：
  - `NEXT_PUBLIC_PLAYBOOK_DEBUG`
  - `NEXT_PUBLIC_PLAYBOOK_DEBUG_APP_TOKEN`
  - `NEXT_PUBLIC_PLAYBOOK_DEBUG_TABLE_ID`
  - `ARTICLE_DEBUG`
  - `ARTICLE_DEBUG_DOCS_URL`
- 读取位置：
  - `lib/playbook-data-source.ts`
  - `app/api/article/route.ts`

## 9. AI 修改建议（必读）

- 改 API 返回结构时：
  1. 更新 `app/article/[slug]/article-types.ts`
  2. 升级 `ARTICLE_CACHE_SCHEMA_VERSION`
  3. 检查 `article-content.tsx` 和 `article-markdown.tsx` 是否同步
- 改正文视觉时：优先改 `article-prose.module.css`，避免在多个 TSX 写内联样式
- 改标题/目录时：同时核对
  - `article-heading-level-map.ts`
  - `page.tsx` 的 `tocItems`
  - `article-content.tsx` 的标题渲染
- 改错误态时：统一走 `article-error-state.tsx`，不要散落多个 error UI

## 10. 本地验证命令

```bash
npm run build
```

- 本仓库以 build 作为主要回归验证（含 TS 检查）。

---

若 AI 要进行中大型改动，建议先输出“变更影响面清单”（API、类型、UI、缓存版本、回归点）再实施。
