"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { getCachedPlaybookBase, setCachedPlaybookBase } from "@/lib/client/playbook-cache";

import { PlaybookFullscreenPathTracers } from "@/app/lark_growth_design_playbook/playbook-fullscreen-path-tracers";

import { formatCoverMetaLine } from "@/lib/cover-meta-line";
import { getPlaybookAppToken, getPlaybookTableId } from "@/lib/playbook-data-source";
import { itemHasHeroHighlight, itemHasPublishedStatus } from "@/lib/playbook-status";
import {
  bgStaticAttachmentUrlFromFields,
  hoverImageAttachmentUrlFromFields,
} from "./playbook-card-cover-media";
import { ErrorBoundary } from "@/app/components/error-boundary";

const BR_TAG_REGEX = /<br\s*\/?>/gi;

function renderTextWithBreaks(text: string): ReactNode {
  const segments = text.split(BR_TAG_REGEX);
  return segments.map((segment, index) => (
    <span key={`${segment}-${index}`}>
      {segment}
      {index < segments.length - 1 ? <br /> : null}
    </span>
  ));
}

function stripBrTags(text: string): string {
  return text.replace(BR_TAG_REGEX, "").trim();
}

type BaseRecord = {
  record_id: string;
  /** 飞书多维表格记录常见顶层字段，用于「最新」排序 */
  created_time?: number | string;
  last_modified_time?: number | string;
  fields: {
    Title?: string;
    Category?: string | string[];
    category?: string | string[];
    Region?: string[];
    /** 多选标签等，与 Region 一并纳入元信息展示 */
    Tags?: unknown;
    tags?: unknown;
    Tag?: unknown;
    tag?: unknown;
    Cover?: Array<{
      file_token?: string;
      url?: string;
      tmp_url?: string;
      name?: string;
      type?: string;
      size?: number;
    }>;
    /** 附件：webm 封面，列表 hover 播放 */
    Motion?: Array<{
      file_token?: string;
      url?: string;
      tmp_url?: string;
      name?: string;
      type?: string;
      size?: number;
    }>;
    Docs?: {
      link: string;
      text: string;
    };
    /** 文章路径与渐变种子主键；API 也可能返回小写字段名 `slug` */
    Slug?: string;
    slug?: string;
    /** 列表/封面主文案；与文章页一致，可与 Title 组合展示 */
    Subtitle?: string;
    subtitle?: string;
    /** 多维表格摘要，用于卡片 hover 文章预览 */
    Summary?: string;
    summary?: string;
    /** 单选或多选；Hero 仅含 highlight 的条目 */
    Status?: unknown;
    [key: string]: any;
  };
};

/** 飞书字段可能为 Title / title 等形式 */
function playbookFieldString(
  fields: BaseRecord["fields"],
  ...keys: string[]
): string {
  for (const key of keys) {
    const raw = (fields as Record<string, unknown>)[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return "";
}

function playbookFieldStringList(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(playbookFieldStringList);
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return [o.text, o.name, o.label, o.value].flatMap(playbookFieldStringList);
  }
  return [];
}

function playbookCategoriesFromFields(fields: BaseRecord["fields"]): string[] {
  return playbookFieldStringList(fields.Category ?? fields.category);
}

/**
 * 与文章页 Hero 一致：有 Subtitle 时主标题为副标题，Title 作辅线；否则主标题为 Title。
 * （仅用于 Hero 轮播；列表子卡片用 Title/Subtitle 字段一一映射，不做互换。）
 */
function playbookDisplayHeadline(fields: BaseRecord["fields"]): {
  primary: string;
  secondary: string | null;
} {
  const title = playbookFieldString(fields, "Title", "title");
  const subtitle = playbookFieldString(fields, "Subtitle", "subtitle");
  if (subtitle && title) {
    return { primary: subtitle, secondary: title };
  }
  if (subtitle) {
    return { primary: subtitle, secondary: null };
  }
  return { primary: title || "Untitled", secondary: null };
}

type BaseData = {
  items: BaseRecord[];
  total: number;
  has_more: boolean;
};

type CardArticlePreview = {
  summary: string;
  firstImageUrl: string | null;
};

const APP_TOKEN = getPlaybookAppToken();
const TABLE_ID = getPlaybookTableId();
const cardArticlePreviewCache = new Map<string, CardArticlePreview>();

/** Hero 全屏 ↔ 卡片：比 cubic 更顺滑的加减速 */
function easeInOutQuint(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2;
}

const HERO_SNAP_MS = 880;
/** 切换完成后新 UI 渐显时长（与渐隐时长 HERO_SNAP_MS 分离） */
const HERO_CHROME_FADE_IN_MS = 520;

type HeroSnapAnim = {
  active: boolean;
  startTime: number;
  from: number;
  to: number;
};

function readHeroSpVisual(anim: HeroSnapAnim, spRef: { current: number }, now: number): number {
  if (!anim.active) return spRef.current;
  const u = Math.min(1, (now - anim.startTime) / HERO_SNAP_MS);
  const p = easeInOutQuint(u);
  return anim.from + (anim.to - anim.from) * p;
}

const HERO_CARD_GAP_PX = 12;
/** 卡片顶相对 Hero 外包层的 offset（px），与 `heroLayout.top` 一致；0 表示贴齐内容区顶边 */
const HERO_LOGO_CLEARANCE_PX = 0;
/** Hero 不低于视口的 50%，并设置固定最小高度 */
const HERO_MIN_HEIGHT_RATIO = 0.5;
const HERO_CARD_HEIGHT_PX = 450;
/** Hero 外框最大宽（90rem 按 16px），比正文区更宽以贴近横幅布局 */
const HERO_MAX_CONTENT_PX = 90 * 16;

/** 与首屏外包层 `px-3 sm:px-4 lg:px-6` 一致，供布局计算与 CSS 对齐 */
function playbookHorizontalPaddingPx(viewportW: number) {
  const w = Math.max(320, viewportW);
  if (w >= 1024) return 24;
  if (w >= 640) return 16;
  return 12;
}

/**
 * 与首屏 `mx-auto max-w-[90rem] px-3 sm:px-4 lg:px-6` 内容区内宽一致。
 * 全屏动画最后一帧仍用该宽度；列表区与之相同，避免 Hero 与卡片栅格宽度错位。
 */
function playbookMainContentInnerWidthPx(viewportW: number) {
  const safeW = Math.max(320, viewportW);
  const shell = Math.min(HERO_MAX_CONTENT_PX, safeW);
  const padX = playbookHorizontalPaddingPx(safeW);
  return Math.max(200, shell - 2 * padX);
}

function playbookListContentInnerWidthPx(viewportW: number) {
  return playbookMainContentInnerWidthPx(viewportW);
}

function playbookGridCardWidthPx(viewportW: number) {
  const safeW = Math.max(320, viewportW);
  const contentW = playbookListContentInnerWidthPx(safeW);
  if (safeW >= 1024) return Math.max(1, (contentW - 2 * 40) / 3);
  if (safeW >= 640) return Math.max(1, (contentW - 36) / 2);
  return contentW;
}

function optimizedFeishuImageUrl(src: string, width: number, quality = 72) {
  if (!src.includes("/api/feishu-image")) return src;
  const url = new URL(src, "https://local.invalid");
  url.searchParams.set("w", String(Math.round(width)));
  url.searchParams.set("q", String(quality));
  return src.startsWith("http") ? url.toString() : `${url.pathname}?${url.searchParams.toString()}`;
}

function firstArticleImageFromApiData(data: unknown): string | null {
  const imageUrls = (data as { imageUrls?: unknown }).imageUrls;
  if (Array.isArray(imageUrls)) {
    const first = imageUrls.find((url): url is string => typeof url === "string" && url.trim().length > 0);
    if (first) return optimizedFeishuImageUrl(first.trim(), 720, 68);
  }

  const blocks = (data as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    const imageUrl = (block as { imageUrl?: unknown }).imageUrl;
    if (typeof imageUrl === "string" && imageUrl.trim().length > 0) {
      return optimizedFeishuImageUrl(imageUrl.trim(), 720, 68);
    }
  }
  return null;
}

/** 卡片态 Hero 高度：至少高于下方 4:3 横向列表封面（与全屏↔卡片动画共用） */
function heroCollapsedHeightPx(viewportW: number, viewportH: number) {
  void viewportW;
  void viewportH;
  return HERO_CARD_HEIGHT_PX;
}

function computeHeroLayout(viewportW: number, viewportH: number, p: number) {
  const safeW = Math.max(320, viewportW);
  const safeH = Math.max(480, viewportH);
  const pp = Math.min(1, Math.max(0, p));
  const cardW = playbookMainContentInnerWidthPx(safeW);
  const collapsedH = heroCollapsedHeightPx(safeW, viewportH);
  const outerW = (1 - pp) * safeW + pp * cardW;
  const outerH = (1 - pp) * safeH + pp * collapsedH;
  const top = pp * HERO_LOGO_CLEARANCE_PX;
  const viewportScale = safeW > 0 ? outerW / safeW : 1;
  const radius = 12 * pp;
  return { outerW, outerH, top, viewportScale, collapsedH, cardW, radius };
}

function recordRecencyMs(r: BaseRecord): number {
  const raw = r.last_modified_time ?? r.created_time;
  if (raw == null) return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Hero：仅 Status 含 highlight 的记录，按修改/创建时间取最新若干条 */
function latestRecordsForHero(items: BaseRecord[], limit: number): BaseRecord[] {
  const highlighted = items.filter((item) => itemHasHeroHighlight(item));
  if (highlighted.length === 0 || limit <= 0) return [];
  const indexed = highlighted.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    const ta = recordRecencyMs(a.item);
    const tb = recordRecencyMs(b.item);
    if (tb !== ta) return tb - ta;
    return b.index - a.index;
  });
  return indexed.slice(0, limit).map(({ item }) => item);
}

/** 卡片 Hero 顶栏「展开全屏」图标 */
function PlaybookCardFullscreenIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M9 3H5a2 2 0 0 0-2 2v4m12-6h4a2 2 0 0 1 2 2v4M7 21H5a2 2 0 0 1-2-2v-4m16 0v4a2 2 0 0 1-2 2h-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type HeroChromeSurface = "fullscreen" | "card";

type PlaybookHeroSlidesCardChromeProps = {
  heroSlides: BaseRecord[];
  activeHeroSlide: number;
  stripEmojiFn: (value: string) => string;
  onSelectSlide: (index: number) => void;
};

function PlaybookHeroSlideBars({
  count,
  activeIndex,
  onSelect,
  className,
}: {
  count: number;
  activeIndex: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  if (count <= 1) return null;
  return (
    <div className={className}>
      <div className="flex items-center justify-center gap-2">
        {Array.from({ length: count }).map((_, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={`hero-bar-${index}`}
              type="button"
              onClick={() => onSelect(index)}
              aria-label={`切换到第 ${index + 1} 条 highlight`}
              aria-pressed={active}
              className={`h-1.5 cursor-pointer rounded-full transition-all duration-300 ease-out ${
                active ? "w-9 bg-white/95" : "w-5 bg-white/45 hover:bg-white/70"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

function PlaybookHeroSlidesCardChrome({
  heroSlides,
  activeHeroSlide,
  stripEmojiFn,
  onSelectSlide,
}: PlaybookHeroSlidesCardChromeProps) {
  if (heroSlides.length === 0) return null;

  const currentSlide =
    heroSlides[Math.max(0, Math.min(heroSlides.length - 1, activeHeroSlide))]!;
  const { primary: headlinePrimary, secondary: headlineSecondary } =
    playbookDisplayHeadline(currentSlide.fields);
  const copyMeta = formatCoverMetaLine(
    currentSlide.fields as Record<string, unknown>,
    stripEmojiFn
  );
  const copyHref = `/article/${currentSlide.fields.Slug || currentSlide.record_id}?rid=${encodeURIComponent(currentSlide.record_id)}`;

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
      <div
        className="relative min-h-0 flex-1"
      >
        <div
          className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-center px-2 pb-14 pt-2 sm:px-3 sm:pb-16 sm:pt-4 lg:px-4"
          aria-live="polite"
        >
          <div
            key={currentSlide.record_id}
            className="playbook-hero-copy-swap pointer-events-auto w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {copyMeta ? (
              <p className="mb-3 text-center text-xs font-medium uppercase tracking-wide text-white/75 sm:mb-4">
                {copyMeta}
              </p>
            ) : null}
            {headlineSecondary ? (
              <p className="mb-2 text-center text-sm font-semibold tracking-tight text-white/90 sm:mb-3 sm:text-base">
                {renderTextWithBreaks(headlineSecondary)}
              </p>
            ) : null}
            <h1 className="mx-auto max-w-[960px] text-balance text-xl font-semibold leading-[1.1] tracking-tight text-white sm:text-2xl md:text-3xl lg:text-4xl">
              {renderTextWithBreaks(headlinePrimary)}
            </h1>
            <Link
              href={copyHref}
              className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-stone-900 transition-[opacity,transform] duration-200 ease-out hover:opacity-95 active:scale-[0.98] sm:mt-6 sm:px-5 sm:py-2.5"
            >
              阅读全文
            </Link>
          </div>
        </div>
        <PlaybookHeroSlideBars
          count={heroSlides.length}
          activeIndex={activeHeroSlide}
          onSelect={onSelectSlide}
          className="pointer-events-auto absolute inset-x-0 bottom-4 z-30"
        />
      </div>
    </div>
  );
}

type PlaybookHeroSlidesFullscreenChromeProps = {
  heroSlides: BaseRecord[];
  activeHeroSlide: number;
  stripEmojiFn: (value: string) => string;
  onEnterCardMode: () => void;
  onSelectSlide: (index: number) => void;
};

function PlaybookHeroSlidesFullscreenChrome({
  heroSlides,
  activeHeroSlide,
  stripEmojiFn,
  onEnterCardMode,
  onSelectSlide,
}: PlaybookHeroSlidesFullscreenChromeProps) {
  if (heroSlides.length === 0) return null;

  const currentSlide =
    heroSlides[Math.max(0, Math.min(heroSlides.length - 1, activeHeroSlide))]!;
  const { primary: headlinePrimary, secondary: headlineSecondary } =
    playbookDisplayHeadline(currentSlide.fields);
  const copyMeta = formatCoverMetaLine(
    currentSlide.fields as Record<string, unknown>,
    stripEmojiFn
  );
  const copyHref = `/article/${currentSlide.fields.Slug || currentSlide.record_id}?rid=${encodeURIComponent(currentSlide.record_id)}`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        role="navigation"
        aria-label="Playbook"
        className="relative z-20 grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-6 pb-3 pt-6 sm:px-8 sm:pt-8 lg:px-12 lg:pt-10"
      >
        <div className="flex min-w-0 justify-start">
          <Link
            href="/lark_growth_design_playbook"
            className="flex shrink-0 items-center outline-offset-4"
          >
            <Image
              src="/Lark%20Design.svg"
              alt="Lark Design"
              width={186}
              height={38}
              className="h-9 w-auto brightness-0 invert"
              priority
            />
          </Link>
        </div>
        <p className="pointer-events-none max-w-[min(52vw,20rem)] truncate px-2 text-center text-xs font-semibold uppercase tracking-wide text-white/95 sm:max-w-[min(40vw,28rem)] sm:text-sm md:max-w-none md:overflow-visible md:whitespace-normal md:text-clip">
          Lark Growth Design Playbook
        </p>
        <div className="flex min-w-0 justify-end">
          <button
            type="button"
            onClick={onEnterCardMode}
            className="shrink-0 rounded-full border border-white/90 bg-transparent px-3.5 py-1.5 text-xs font-medium text-white transition-colors duration-200 ease-out hover:border-white hover:bg-white/10 sm:px-4 sm:py-2 sm:text-sm"
          >
            查看全部
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-center px-6 pb-20 pt-10 sm:px-8 sm:pb-24 sm:pt-14 lg:px-12 lg:pr-16"
          aria-live="polite"
        >
          <div
            key={currentSlide.record_id}
            className="playbook-hero-copy-swap pointer-events-auto max-w-4xl"
          >
            {copyMeta ? (
              <p className="mb-6 text-left text-xs font-medium uppercase tracking-wide text-white/75">
                {copyMeta}
              </p>
            ) : null}
            {headlineSecondary ? (
              <p className="mb-3 text-left text-base font-semibold tracking-tight text-white/90 sm:mb-4 sm:text-lg">
                {renderTextWithBreaks(headlineSecondary)}
              </p>
            ) : null}
            <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl">
              {renderTextWithBreaks(headlinePrimary)}
            </h1>
            <Link
              href={copyHref}
              className="mt-8 inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 transition-[opacity,transform] duration-200 ease-out hover:opacity-95 active:scale-[0.98]"
            >
              阅读全文
              <span aria-hidden className="translate-y-px">
                &gt;
              </span>
            </Link>
          </div>
        </div>
        <PlaybookHeroSlideBars
          count={heroSlides.length}
          activeIndex={activeHeroSlide}
          onSelect={onSelectSlide}
          className="pointer-events-auto absolute inset-x-0 bottom-8 z-30"
        />
      </div>
    </div>
  );
}

function PlaybookHeroEmptyCardChrome() {
  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col items-stretch">
    </div>
  );
}

function PlaybookHeroEmptyFullscreenChrome({ onToggleLayout }: { onToggleLayout: () => void }) {
  return (
    <>
      <div
        role="navigation"
        aria-label="Playbook"
        className="relative z-20 flex shrink-0 items-center justify-between gap-4 px-6 pb-2 pt-6 sm:px-8 sm:pt-8 lg:px-12 lg:pt-10"
      >
        <Link
          href="/lark_growth_design_playbook"
          className="flex min-w-0 shrink-0 items-center outline-offset-4"
        >
          <Image
            src="/Lark%20Design.svg"
            alt="Lark Design"
            width={186}
            height={38}
            className="h-9 w-auto brightness-0 invert"
            priority
          />
        </Link>
        <button
          type="button"
          onClick={onToggleLayout}
          className="shrink-0 rounded-full border border-stone-900/15 bg-white/85 px-3 py-1.5 text-xs font-semibold text-stone-800 backdrop-blur-sm transition-colors duration-300 ease-[cubic-bezier(0.33,1,0.68,1)] hover:bg-white sm:text-sm"
          aria-pressed={false}
          aria-label="收起为卡片"
        >
          卡片
        </button>
      </div>
      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-6 py-10 sm:px-8 sm:py-14 lg:px-12">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl md:text-6xl">
            Lark Growth Design Playbook
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-white/75">
            Discover insights, experiments, and best practices for driving growth through design.
          </p>
        </div>
      </div>
    </>
  );
}

function PlaybookCardCover({
  staticBgUrl,
}: {
  staticBgUrl: string | null;
}) {
  return (
    <div
      className="absolute inset-0 z-0 scale-200 transform-gpu transition-transform duration-500 ease-[cubic-bezier(0.33,1,0.68,1)] group-hover:scale-240"
      aria-hidden
      style={{
        backgroundColor: "#e7e5e4",
        backgroundImage: staticBgUrl ? `url('${staticBgUrl}')` : "none",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        filter: "blur(0px)",
      }}
    />
  );
}

function PlaybookCardItem({
  item,
  index,
  selectedCategory,
  selectedRegion,
  stripEmoji,
}: {
  item: BaseRecord;
  index: number;
  selectedCategory: string | null;
  selectedRegion: string | null;
  stripEmoji: (text: string) => string;
}) {
  const router = useRouter();
  const previewRequestStartedRef = useRef(false);
  const cardTitle = stripBrTags(
    playbookFieldString(item.fields, "Title", "title")
  );
  const cardSubtitle = stripBrTags(
    playbookFieldString(item.fields, "Subtitle", "subtitle")
  );
  const cardSummary = stripBrTags(
    playbookFieldString(item.fields, "Summary", "summary")
  );
  const cardMainHeadline = cardTitle || cardSubtitle || "Untitled";
  const [articlePreview, setArticlePreview] = useState<CardArticlePreview>(() => {
    const cached = cardArticlePreviewCache.get(item.record_id);
    return cached ?? { summary: cardSummary, firstImageUrl: null };
  });
  const cardPreviewSummary = articlePreview.summary || cardSummary || cardSubtitle || cardTitle;
  const showSubtitleBelow = Boolean(cardTitle && cardSubtitle);
  const cardMeta = formatCoverMetaLine(
    item.fields as Record<string, unknown>,
    stripEmoji
  );
  const hoverImageUrl = hoverImageAttachmentUrlFromFields(item.fields as Record<string, unknown>);
  const cardBgStaticUrl = bgStaticAttachmentUrlFromFields(item.fields as Record<string, unknown>);
  const href = useMemo(
    () =>
      `/article/${item.fields.Slug || item.record_id}?rid=${encodeURIComponent(
        item.record_id
      )}`,
    [item.fields.Slug, item.record_id]
  );
  const loadArticlePreview = useCallback(() => {
    router.prefetch(href);
    const cached = cardArticlePreviewCache.get(item.record_id);
    if (cached) {
      setArticlePreview(cached);
      return;
    }
    if (previewRequestStartedRef.current) return;
    previewRequestStartedRef.current = true;

    if (hoverImageUrl) {
      const preview = { summary: cardSummary, firstImageUrl: hoverImageUrl };
      cardArticlePreviewCache.set(item.record_id, preview);
      setArticlePreview(preview);
      return;
    }

    setArticlePreview({ summary: cardSummary, firstImageUrl: null });

    const params = new URLSearchParams({
      appToken: APP_TOKEN,
      tableId: TABLE_ID,
      recordId: item.record_id,
    });

    void fetch(`/api/article?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => {
        if (!result?.ok) {
          previewRequestStartedRef.current = false;
          return;
        }
        const preview = {
          summary: cardSummary,
          firstImageUrl: firstArticleImageFromApiData(result.data),
        };
        cardArticlePreviewCache.set(item.record_id, preview);
        setArticlePreview(preview);
      })
      .catch(() => {
        previewRequestStartedRef.current = false;
      });
  }, [cardSummary, hoverImageUrl, href, item.record_id, router]);

  return (
    <Link
      key={`${item.record_id}-${selectedCategory ?? "c"}-${selectedRegion ?? "r"}`}
      href={href}
      className="playbook-card-enter group flex flex-col focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
      onFocus={loadArticlePreview}
      style={{
        animationDelay: `${Math.min(index, 24) * 64}ms`,
      }}
    >
      <div
        className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-xl transition-transform duration-500 ease-[cubic-bezier(0.33,1,0.68,1)] will-change-transform group-hover:scale-[1.02]"
        onMouseEnter={loadArticlePreview}
      >
        <PlaybookCardCover
          staticBgUrl={cardBgStaticUrl}
        />
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 px-2 text-center transition-opacity duration-300 ease-out group-hover:opacity-0 sm:gap-2 sm:px-3">
          {cardMeta ? (
            <p className="line-clamp-2 text-center text-[0.625rem] font-medium uppercase leading-tight tracking-wide text-white/75 sm:text-[0.6875rem]">
              {cardMeta}
            </p>
          ) : null}
          <h2 className="line-clamp-4 text-balance text-xs font-semibold leading-snug tracking-tight text-white sm:text-sm md:text-base">
            {cardMainHeadline}
          </h2>
        </div>
        {articlePreview.firstImageUrl ? (
          <img
            src={articlePreview.firstImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="pointer-events-none absolute inset-0 z-20 h-full w-full object-cover opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100"
            aria-hidden
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 z-[25] bg-black/35 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-4 pb-4 pt-12 text-left text-white opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 sm:px-5 sm:pb-5 sm:pt-16">
          <p className="line-clamp-3 text-xs font-medium leading-relaxed text-white/90 sm:text-sm">
            {cardPreviewSummary || "暂无 Summary"}
          </p>
        </div>
      </div>

      {showSubtitleBelow ? (
        <div className="px-2 pb-2 pt-3 text-left sm:px-1 sm:pb-2">
          <p className="line-clamp-2 text-xs font-semibold leading-snug tracking-tight text-stone-700 sm:text-[0.9rem]">
            {cardSubtitle}
          </p>
        </div>
      ) : null}
    </Link>
  );
}

function PlaybookPage() {
  const [data, setData] = useState<BaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [splashVisible, setSplashVisible] = useState(true);
  const [isFetching, setIsFetching] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [isFilterSticky, setIsFilterSticky] = useState(false);
  const [activeHeroSlide, setActiveHeroSlide] = useState(0);
  const [heroSpDisplay, setHeroSpDisplay] = useState(1);
  /** 与 heroSp 目标一致：全屏(0) 时锁整页滚动，卡片(1) 时恢复 */
  const [heroWantsFullLayout, setHeroWantsFullLayout] = useState(false);
  /** 全屏→卡片完成后递增，强制列表重挂载以重播 playbook-card-enter */
  const [cardGridRevealEpoch, setCardGridRevealEpoch] = useState(0);
  /** 正在过渡到卡片模式时隐藏列表，避免 Hero 动画期间先看到静态卡片 */
  const [cardGridAwaitingReveal, setCardGridAwaitingReveal] = useState(false);
  /** 全屏 / 卡片两套 Hero 控件：全屏→卡片在 snap 结束后切换；卡片→全屏在 snap 开始时切换以免宽度被 main 夹住 */
  const [heroChromeSurface, setHeroChromeSurface] = useState<HeroChromeSurface>("card");
  const [heroChromeVisible, setHeroChromeVisible] = useState(true);
  const [heroChromeFadeMs, setHeroChromeFadeMs] = useState(HERO_SNAP_MS);
  /** 全屏↔卡片 outer 几何在跑 HERO_SNAP_MS 时：冻结 Hero shader，与列表卡片默认静止同一逻辑，避免形变过程中时间轴还在走 */
  const [heroSnapLayoutAnimating, setHeroSnapLayoutAnimating] = useState(false);
  const [viewportSize, setViewportSize] = useState({ w: 1200, h: 800 });
  const heroSpDisplayRef = useRef(1);
  const heroMotionReduceRef = useRef(false);
  /** WebGL 背景在 prefers-reduced-motion 时关闭，仅保留 CSS 渐变 */
  const [reduceHeroShaderMotion, setReduceHeroShaderMotion] = useState(false);

  const heroAnimRef = useRef<HeroSnapAnim>({
    active: false,
    startTime: 0,
    from: 0,
    to: 0,
  });
  const heroScrollPortRef = useRef<HTMLDivElement | null>(null);
  const filterBarRef = useRef<HTMLDivElement | null>(null);

  const beginHeroSnap = useCallback((to: number) => {
    const now = performance.now();
    const visual = readHeroSpVisual(heroAnimRef.current, heroSpDisplayRef, now);
    if (heroMotionReduceRef.current) {
      const a = heroAnimRef.current;
      a.active = false;
      heroSpDisplayRef.current = to;
      setHeroSpDisplay(to);
      setHeroWantsFullLayout(to < 0.5);
      setHeroChromeSurface(to === 1 ? "card" : "fullscreen");
      setHeroChromeFadeMs(HERO_CHROME_FADE_IN_MS);
      setHeroChromeVisible(true);
      setCardGridAwaitingReveal(false);
      if (to === 1) setCardGridRevealEpoch((e) => e + 1);
      return;
    }
    if (Math.abs(visual - to) < 0.004) return;
    setHeroWantsFullLayout(to < 0.5);
    if (to === 0) setCardGridAwaitingReveal(false);
    if (to === 1) setCardGridAwaitingReveal(true);
    /**
     * 卡片→全屏：立刻挂到全屏 DOM。若在 card 分支里动画，header 会受 main 内 `max-width:100%` 限制无法随 outerW 变宽，收尾与全屏布局不一致。
     * 全屏→卡片：仍只在动画结束再切 card（最后一帧宽度已与 main 内容区对齐）。
     */
    if (to === 0) setHeroChromeSurface("fullscreen");
    setHeroChromeFadeMs(HERO_SNAP_MS);
    setHeroChromeVisible(false);
    setHeroSnapLayoutAnimating(true);
    const a = heroAnimRef.current;
    a.active = true;
    a.startTime = now;
    a.from = visual;
    a.to = to;
  }, []);

  const toggleHeroLayout = useCallback(() => {
    const now = performance.now();
    const visual = readHeroSpVisual(heroAnimRef.current, heroSpDisplayRef, now);
    beginHeroSnap(visual < 0.5 ? 1 : 0);
  }, [beginHeroSnap]);

  const dismissSplash = useCallback(() => {
    setSplashVisible(false);
    setLoading(false);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setSplashVisible(true);
    setIsFetching(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/test-feishu?action=base&appToken=${APP_TOKEN}&tableId=${TABLE_ID}`
      );
      const result = await response.json();

      if (result.ok) {
        const source = result.data as BaseData;
        const publishedItems = (source.items ?? []).filter(itemHasPublishedStatus);
        const nextData = {
          ...source,
          items: publishedItems,
          total: publishedItems.length,
          has_more: false,
        };
        setData(nextData);
        setCachedPlaybookBase("default", nextData);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsFetching(false);
      setTimeout(() => {
        dismissSplash();
      }, 600);
    }
  };

  useEffect(() => {
    const cached = getCachedPlaybookBase("default") as BaseData | null;
    if (cached?.items?.length) {
      setData(cached);
      setIsFetching(false);
      setSplashVisible(false);
      setLoading(false);
      // 后台静默刷新，避免返回首页的 loading
      void (async () => {
        try {
          const response = await fetch(
            `/api/test-feishu?action=base&appToken=${APP_TOKEN}&tableId=${TABLE_ID}`
          );
          const result = await response.json();
          if (result.ok) {
            const source = result.data as BaseData;
            const publishedItems = (source.items ?? []).filter(itemHasPublishedStatus);
            const nextData = {
              ...source,
              items: publishedItems,
              total: publishedItems.length,
              has_more: false,
            };
            setCachedPlaybookBase("default", nextData);
            setData(nextData);
          }
        } catch {
          // ignore
        }
      })();
      return;
    }
    fetchData();
  }, []);

  const getCategories = () => {
    if (!data?.items) return [];
    const categories = new Set<string>();
    data.items.forEach((item) => {
      for (const category of playbookCategoriesFromFields(item.fields)) {
        categories.add(category);
      }
    });
    return Array.from(categories);
  };

  const getRegions = () => {
    if (!data?.items) return [];
    const regions = new Set<string>();
    data.items.forEach((item) => {
      if (item.fields.Region) {
        item.fields.Region.forEach((r) => regions.add(r));
      }
    });
    return Array.from(regions);
  };

  const filteredItems = () => {
    if (!data?.items) return [];
    return data.items.filter((item) => {
      const categoryMatch =
        !selectedCategory || playbookCategoriesFromFields(item.fields).includes(selectedCategory);
      const regionMatch = !selectedRegion || 
        (item.fields.Region && item.fields.Region.includes(selectedRegion));
      return categoryMatch && regionMatch;
    });
  };

  const stripEmoji = (value: string) =>
    value
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/\uFE0F/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const visibleItems = filteredItems();
  const HERO_LATEST_COUNT = 5;
  const HERO_AUTOPLAY_MS = 5200;
  const heroSlides = latestRecordsForHero(data?.items ?? [], HERO_LATEST_COUNT);
  const heroSlidesKey = heroSlides.map((h) => h.record_id).join(",");
  const activeHeroBgRecord =
    heroSlides.length > 0
      ? (heroSlides[Math.max(0, Math.min(heroSlides.length - 1, activeHeroSlide))] ?? null)
      : null;
  const activeHeroBgStaticUrl = activeHeroBgRecord
    ? bgStaticAttachmentUrlFromFields(activeHeroBgRecord.fields as Record<string, unknown>)
    : null;
  const showCardTopDebugControls =
    typeof process !== "undefined" &&
    (process.env.NEXT_PUBLIC_PLAYBOOK_DEBUG === "true" || process.env.NEXT_PUBLIC_PLAYBOOK_DEBUG === "1");

  const scrollPageLocked = heroSlides.length > 0 && heroWantsFullLayout;

  useEffect(() => {
    if (!scrollPageLocked) {
      document.documentElement.style.removeProperty("overflow");
      document.body.style.removeProperty("overflow");
      return;
    }
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    window.scrollTo(0, 0);
    return () => {
      document.documentElement.style.removeProperty("overflow");
      document.body.style.removeProperty("overflow");
    };
  }, [scrollPageLocked]);

  useEffect(() => {
    setActiveHeroSlide(0);
  }, [heroSlidesKey]);

  useEffect(() => {
    if (heroSlides.length === 0) return;
    if (activeHeroSlide >= heroSlides.length) {
      setActiveHeroSlide(0);
    }
  }, [heroSlides.length, activeHeroSlide]);

  useEffect(() => {
    if (heroSlides.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveHeroSlide((prev) => (prev + 1) % heroSlides.length);
    }, HERO_AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [heroSlides.length, heroSlidesKey, HERO_AUTOPLAY_MS]);

  useEffect(() => {
    const syncViewport = () =>
      setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMq = () => {
      heroMotionReduceRef.current = mq.matches;
      setReduceHeroShaderMotion(mq.matches);
    };
    syncMq();
    mq.addEventListener("change", syncMq);
    return () => mq.removeEventListener("change", syncMq);
  }, []);

  /** 全屏 ↔ 卡片：临界值触发后缓动到目标（时长见 HERO_SNAP_MS） */
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const a = heroAnimRef.current;
      if (a.active) {
        const now = performance.now();
        const u = Math.min(1, (now - a.startTime) / HERO_SNAP_MS);
        const p = easeInOutQuint(u);
        const v = a.from + (a.to - a.from) * p;
        heroSpDisplayRef.current = v;
        setHeroSpDisplay(v);
        if (u >= 1) {
          a.active = false;
          heroSpDisplayRef.current = a.to;
          setHeroSpDisplay(a.to);
          setHeroSnapLayoutAnimating(false);
          const nextSurface: HeroChromeSurface = a.to === 1 ? "card" : "fullscreen";
          setHeroChromeSurface(nextSurface);
          setHeroChromeFadeMs(HERO_CHROME_FADE_IN_MS);
          setHeroChromeVisible(false);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => setHeroChromeVisible(true));
          });
          if (a.to === 1) {
            setCardGridAwaitingReveal(false);
            setCardGridRevealEpoch((e) => e + 1);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let raf = 0;

    const tick = () => {
      if (filterBarRef.current) {
        const { top } = filterBarRef.current.getBoundingClientRect();
        /** 筛选条 `top:0` 吸顶；条顶贴近视口顶时显示收缩态 Logo */
        setIsFilterSticky(top <= 6);
      }
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };

    tick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", tick);
    };
  }, [loading]);

  const heroSp = heroSpDisplay;
  const heroLayout = computeHeroLayout(viewportSize.w, viewportSize.h, heroSp);
  const heroImageWidth = viewportSize.w >= 1024 ? 1600 : 960;
  const activeHeroBgImageUrl = useMemo(
    () =>
      activeHeroBgStaticUrl
        ? optimizedFeishuImageUrl(activeHeroBgStaticUrl, heroImageWidth, 72)
        : null,
    [activeHeroBgStaticUrl, heroImageWidth]
  );

  useEffect(() => {
    if (!activeHeroBgImageUrl) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = activeHeroBgImageUrl;
    link.fetchPriority = "high";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, [activeHeroBgImageUrl]);

  const heroShellBgTransparent = heroSp < 0.02;
  /** 全屏幻灯：隐藏首屏以下 UI，避免缩放/圆角外漏出白底或列表 */
  const playbookChromeFullscreen = heroChromeSurface === "fullscreen";

  const showPage = !loading;

  useEffect(() => {
    if (!showPage) return;
    if (playbookChromeFullscreen) {
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
    } else {
      document.documentElement.style.removeProperty("background");
      document.body.style.removeProperty("background");
    }
    return () => {
      document.documentElement.style.removeProperty("background");
      document.body.style.removeProperty("background");
    };
  }, [showPage, playbookChromeFullscreen]);

  return (
    <div
      className={`relative min-h-screen text-stone-900 ${
        playbookChromeFullscreen ? "bg-transparent" : "bg-white"
      }`}
    >
      {splashVisible ? (
        <div
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-white"
          aria-busy
          aria-live="polite"
        >
          <span className="sr-only">加载中</span>
          <div className="flex flex-col items-center gap-8">
            <Image
              src="/Lark%20Design.svg"
              alt="Lark Design"
              width={186}
              height={38}
              className="h-9 w-auto brightness-0"
              priority
            />
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-stone-200 border-t-stone-900" />
          </div>
        </div>
      ) : null}

      {showPage ? (
        <div
          className={`playbook-page-fade-in ${playbookChromeFullscreen ? "min-h-0 overflow-x-clip" : ""}`}
        >
          <div
            ref={heroScrollPortRef}
            className={
              playbookChromeFullscreen
                ? "relative h-fit w-full shrink-0 isolate"
                : "relative w-full min-h-0"
            }
          >
            <div
              className={`relative z-40 w-full ${
                playbookChromeFullscreen ? "" : "mx-auto max-w-[90rem] px-3 sm:px-4 lg:px-6"
              }`}
              style={{ paddingTop: `${heroLayout.top}px` }}
            >
              {!playbookChromeFullscreen ? (
                <div
                  role="navigation"
                  aria-label="Playbook"
                  className="relative z-30 mt-6 mb-3 flex w-full min-w-0 items-center px-1 py-2 text-stone-900 sm:mb-4 sm:py-2.5"
                >
                  <a
                    href="https://larksuite.com"
                    target="_blank"
                    rel="noreferrer"
                    className="relative z-[1] flex shrink-0 items-center text-stone-900 outline-offset-4"
                  >
                    <Image
                      src="/Lark%20Design.svg"
                      alt="Lark"
                      width={186}
                      height={38}
                      className="h-7 w-auto brightness-0"
                      priority
                    />
                  </a>
                  <p className="pointer-events-none absolute left-1/2 top-1/2 z-0 max-w-[min(100%-7rem,calc(100vw-8rem))] -translate-x-1/2 -translate-y-1/2 px-2 text-center text-[11px] font-semibold uppercase leading-snug tracking-wide text-stone-900 sm:max-w-[min(100%-9rem,44rem)] sm:text-xs md:text-sm">
                    Lark Growth Design Playbook
                  </p>
                  {showCardTopDebugControls ? (
                    <button
                      type="button"
                      onClick={toggleHeroLayout}
                      className="relative z-[1] ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-stone-900/30 bg-white text-stone-900 transition-[background-color,border-color,opacity] duration-200 ease-out hover:border-stone-900/45 hover:bg-stone-100"
                      aria-label="展开全屏"
                    >
                      <PlaybookCardFullscreenIcon className="size-[1.125rem]" />
                    </button>
                  ) : null}
                </div>
              ) : null}
              <header
                className={`relative overflow-hidden text-stone-900 ${heroShellBgTransparent ? "bg-transparent" : "bg-white"}`}
                style={{
                  position: "relative",
                  marginLeft: "auto",
                  marginRight: "auto",
                  width: `${heroLayout.outerW}px`,
                  height: `${heroLayout.outerH}px`,
                  borderRadius: `${heroLayout.radius}px`,
                  maxWidth: "100%",
                }}
              >
                <div
                  className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
                  aria-hidden
                  style={{
                    backgroundColor: "#e7e5e4",
                    backgroundImage: activeHeroBgImageUrl
                      ? `url('${activeHeroBgImageUrl}')`
                      : "none",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                    transform: "scale(1.06)",
                    transformOrigin: "center",
                    filter: "blur(5px)",
                  }}
                />

                {playbookChromeFullscreen ? (
                  heroSlides.length > 0 ? (
                    <div
                      className="z-[5] will-change-transform"
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: 0,
                        width: viewportSize.w,
                        height: viewportSize.h,
                        marginLeft: -viewportSize.w / 2,
                        transform: `scale(${heroLayout.viewportScale})`,
                        transformOrigin: "top center",
                      }}
                    >
                      <div className="relative h-full min-h-0 w-full">
                        <PlaybookFullscreenPathTracers
                          active={showPage && playbookChromeFullscreen}
                          motionPaused={false}
                          reduceMotion={reduceHeroShaderMotion}
                        />
                        <div
                          className={`pointer-events-auto absolute inset-0 z-10 mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col transition-opacity ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none ${!heroChromeVisible ? "pointer-events-none" : ""}`}
                          style={{
                            opacity: heroChromeVisible ? 1 : 0,
                            transitionDuration: `${heroChromeFadeMs}ms`,
                          }}
                        >
                          <PlaybookHeroSlidesFullscreenChrome
                            heroSlides={heroSlides}
                            activeHeroSlide={activeHeroSlide}
                            stripEmojiFn={stripEmoji}
                            onEnterCardMode={() => beginHeroSnap(1)}
                            onSelectSlide={setActiveHeroSlide}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="z-[5] will-change-transform"
                      style={{
                        position: "absolute",
                        left: "50%",
                        top: 0,
                        width: viewportSize.w,
                        height: viewportSize.h,
                        marginLeft: -viewportSize.w / 2,
                        transform: `scale(${heroLayout.viewportScale})`,
                        transformOrigin: "top center",
                      }}
                    >
                      <div className="relative flex h-full min-h-0 w-full flex-col text-white">
                        <PlaybookFullscreenPathTracers
                          active={showPage && playbookChromeFullscreen}
                          motionPaused={false}
                          reduceMotion={reduceHeroShaderMotion}
                        />
                        <div
                          className={`pointer-events-auto absolute inset-0 z-10 mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col transition-opacity ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none ${!heroChromeVisible ? "pointer-events-none" : ""}`}
                          style={{
                            opacity: heroChromeVisible ? 1 : 0,
                            transitionDuration: `${heroChromeFadeMs}ms`,
                          }}
                        >
                          <PlaybookHeroEmptyFullscreenChrome onToggleLayout={toggleHeroLayout} />
                        </div>
                      </div>
                    </div>
                  )
                ) : heroSlides.length > 0 ? (
                  /**
                   * 卡片态：header 高度为 outerH，勿再用「整视口高 + scale」全屏套路，否则正文被 overflow-hidden 裁掉。
                   */
                  <div className="relative z-10 h-full min-h-0 w-full overflow-hidden">
                    <div
                      className={`pointer-events-auto absolute inset-0 z-10 mx-auto flex h-full min-h-0 w-full max-w-none flex-col transition-opacity ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none ${!heroChromeVisible ? "pointer-events-none" : ""}`}
                      style={{
                        opacity: heroChromeVisible ? 1 : 0,
                        transitionDuration: `${heroChromeFadeMs}ms`,
                      }}
                    >
                      <PlaybookHeroSlidesCardChrome
                        heroSlides={heroSlides}
                        activeHeroSlide={activeHeroSlide}
                        stripEmojiFn={stripEmoji}
                        onSelectSlide={setActiveHeroSlide}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="relative z-10 h-full min-h-0 w-full overflow-hidden">
                    <div
                      className={`pointer-events-auto absolute inset-0 z-10 mx-auto flex h-full min-h-0 w-full max-w-none flex-col transition-opacity ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none ${!heroChromeVisible ? "pointer-events-none" : ""}`}
                      style={{
                        opacity: heroChromeVisible ? 1 : 0,
                        transitionDuration: `${heroChromeFadeMs}ms`,
                      }}
                    >
                      <PlaybookHeroEmptyCardChrome />
                    </div>
                  </div>
                )}
              </header>
            </div>

            {playbookChromeFullscreen ? (
              <main
                className="mx-auto max-w-[90rem] pointer-events-none invisible m-0 max-h-0 min-h-0 overflow-hidden border-0 p-0 opacity-0 px-3 py-10 sm:px-4 sm:py-10 lg:px-6"
                aria-hidden
              />
            ) : (
              <main
                className="mx-auto w-full max-w-[90rem] px-3 pb-10 pt-6 sm:px-4 sm:pb-10 lg:px-6"
                aria-hidden={false}
              >
                <div
                  ref={filterBarRef}
                  className={`sticky z-50 py-0 transition-shadow ${
                    isFilterSticky ? "shadow-[0_1px_3px_rgba(0,0,0,0.06)]" : ""
                  }`}
                  style={{ top: 0 }}
                >
                  <div className="pointer-events-none absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 bg-white" />
                  <div className="relative mx-auto w-full px-0">
                    <div className="relative">
                      <div className="overflow-x-auto overflow-y-hidden overscroll-y-none touch-pan-x">
                        <div className="flex w-max min-w-full flex-col items-start gap-2 pt-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-8">
                          <div className="flex items-center gap-5">
                            <button
                              onClick={() => setSelectedCategory(null)}
                              className={`-mb-px min-h-[44px] cursor-pointer border-b-2 px-1 pb-2.5 pt-2 transition-colors ${
                                !selectedCategory
                                  ? "border-stone-900 font-semibold text-stone-900"
                                  : "border-transparent text-stone-500 hover:text-stone-900"
                              }`}
                            >
                              All Categories
                            </button>
                            {getCategories().map((category) => (
                              <button
                                key={category}
                                onClick={() => setSelectedCategory(category)}
                                className={`-mb-px min-h-[44px] cursor-pointer border-b-2 px-1 pb-2.5 pt-2 transition-colors ${
                                  selectedCategory === category
                                    ? "border-stone-900 font-semibold text-stone-900"
                                    : "border-transparent text-stone-500 hover:text-stone-900"
                                }`}
                              >
                                {stripEmoji(category)}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center gap-2 pb-2.5 sm:pl-2">
                            <button
                              onClick={() => setSelectedRegion(null)}
                              className={`cursor-pointer rounded-full px-3 py-2 text-xs transition-colors ${
                                !selectedRegion
                                  ? "bg-stone-100 text-stone-700"
                                  : "text-stone-400 hover:text-stone-700"
                              }`}
                            >
                              All Regions
                            </button>
                            {getRegions().map((region) => (
                              <button
                                key={region}
                                onClick={() => setSelectedRegion(region)}
                                className={`cursor-pointer rounded-full px-3 py-2 text-xs transition-colors ${
                                  selectedRegion === region
                                    ? "bg-stone-100 text-stone-700"
                                    : "text-stone-400 hover:text-stone-700"
                                }`}
                              >
                                {stripEmoji(region)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="mb-10 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {error}
                  </div>
                )}

                {!error && (
                  <div>
                    {visibleItems.length === 0 ? (
                      <div className="py-16 text-center">
                        <p className="text-lg text-stone-500">No items found for the selected filters.</p>
                      </div>
                    ) : (
                      <div
                        className={
                          cardGridAwaitingReveal
                            ? "pointer-events-none select-none opacity-0"
                            : undefined
                        }
                        aria-hidden={cardGridAwaitingReveal}
                      >
                        <div
                          key={cardGridRevealEpoch}
                          className="grid grid-cols-1 gap-8 pt-4 sm:grid-cols-2 sm:gap-9 lg:grid-cols-3 lg:gap-10"
                        >
                          {visibleItems.map((item, i) => (
                            <PlaybookCardItem
                              key={`${item.record_id}-${selectedCategory ?? "c"}-${selectedRegion ?? "r"}`}
                              item={item}
                              index={i}
                              selectedCategory={selectedCategory}
                              selectedRegion={selectedRegion}
                              stripEmoji={stripEmoji}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </main>
            )}
          </div>

          <footer
            className={`mt-10 border-t border-stone-200 ${
              playbookChromeFullscreen
                ? "pointer-events-none invisible m-0 max-h-0 min-h-0 overflow-hidden border-0 p-0 opacity-0"
                : ""
            }`}
            aria-hidden={playbookChromeFullscreen}
          >
            <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-2 px-3 py-6 text-sm text-stone-500 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:px-4 lg:px-6">
              <p>© {new Date().getFullYear()} Lark Growth Design Playbook</p>
              <p>Built for growth stories and design insights.</p>
            </div>
          </footer>
        </div>
      ) : null}
    </div>
  );
}

export default function PlaybookPageWithBoundary() {
  return (
    <ErrorBoundary>
      <PlaybookPage />
    </ErrorBoundary>
  );
}
