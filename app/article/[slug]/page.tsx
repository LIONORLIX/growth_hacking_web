"use client";

/**
 * 文章详情页：按 slug / 调试参数拉取 Playbook 记录与流式正文，
 * 编排开屏动画、吸顶标题、Hero、目录与正文子模块；业务状态与请求逻辑集中在此。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useSearchParams } from "next/navigation";
import type { ArticleApiData, TocItem } from "./article-types";
import { buildHeadingId, normalizeHeadingText } from "./article-heading";
import {
  buildHeadingDisplayLevelMap,
  buildHeadingNumberPrefixesForArticleBlocks,
  buildHeadingNumberPrefixesForPayloads,
  collectRawHeadingLevelsFromArticleBlocks,
  collectRawHeadingLevelsFromPayloads,
  displayHeadingLevel,
  rawHeadingLevelFromApiBlock,
  TOC_MAX_DISPLAY_LEVEL,
} from "./article-heading-level-map";
import { extractDocumentId, pickArticleDocsUrl } from "./article-doc-utils";
import { parseArticleBlocks } from "./modules/article-markdown";
import { ArticleContent } from "./modules/article-content";
import { ArticleSsrFallback } from "./modules/article-ssr-fallback";
import { ArticleSplashOverlay } from "./modules/article-splash-overlay";
import { ArticleStickyTitleBar } from "./modules/article-sticky-title-bar";
import { ArticleHeroCover } from "./modules/article-hero-cover";
import { ArticleTocAside } from "./modules/article-toc-aside";
import { ArticlePageFooter } from "./modules/article-page-footer";
import { ArticleBodyPreviewSkeleton } from "./modules/article-body-preview-skeleton";
import { ArticleStreamFooter } from "./modules/article-stream-footer";
import { ArticleErrorState } from "./modules/article-error-state";
import { ErrorBoundary } from "@/app/components/error-boundary";
import {
  getCachedArticle,
  getCachedPlaybookRecord,
  setCachedArticle,
  setCachedPlaybookRecord,
} from "@/lib/client/article-cache";
import { bgStaticAttachmentUrlFromFields } from "@/app/lark_growth_design_playbook/playbook-card-cover-media";

const APP_TOKEN = "B4K3bAYKTau24es6Dxdcq3FEnig";
const TABLE_ID = "tblHalmUkZ8AZSgp";

function ArticlePage() {
  const [mounted, setMounted] = useState(false);
  const bgShader = "none";
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const recordIdFromQuery = searchParams.get("rid") ?? searchParams.get("recordId") ?? "";
  const debugEnabled = searchParams.get("debug") === "1";
  const debugDocsUrl =
    searchParams.get("debugDocsUrl") ?? searchParams.get("debugDocUrl");

  const [loading, setLoading] = useState(false);
  const [streamComplete, setStreamComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splashVisible, setSplashVisible] = useState(true);
  const [isFetching, setIsFetching] = useState(true);
  const [article, setArticle] = useState<ArticleApiData | null>(null);
  const [articleBgStaticUrl, setArticleBgStaticUrl] = useState<string | null>(null);
  const [articleRecordTitle, setArticleRecordTitle] = useState<string | null>(null);
  const [articleSubtitle, setArticleSubtitle] = useState<string | null>(null);
  const [articleSummary, setArticleSummary] = useState<string | null>(null);
  const articleBlocks = useMemo(
    () => (article ? parseArticleBlocks(article.content) : []),
    [article]
  );
  const headingLevelMap = useMemo(() => {
    const raw =
      article?.blocks?.length && article.blocks.length > 0
        ? collectRawHeadingLevelsFromPayloads(article.blocks)
        : collectRawHeadingLevelsFromArticleBlocks(articleBlocks);
    return buildHeadingDisplayLevelMap(raw);
  }, [article?.blocks, articleBlocks]);
  const headingNumberByBlockIndex = useMemo(() => {
    if (article?.blocks?.length && article.blocks.length > 0) {
      return buildHeadingNumberPrefixesForPayloads(article.blocks, headingLevelMap);
    }
    return buildHeadingNumberPrefixesForArticleBlocks(articleBlocks, headingLevelMap);
  }, [article?.blocks, articleBlocks, headingLevelMap]);
  const articleTitle = useMemo(() => {
    if (article?.docTitle?.trim()) {
      return article.docTitle.trim();
    }
    const fromBlocks = article?.blocks?.find((block) =>
      block.type.startsWith("heading")
    )?.text;
    return fromBlocks?.trim() || "";
  }, [article]);
  const stickyBarTitle = useMemo(() => {
    if (articleRecordTitle?.trim()) return articleRecordTitle.trim();
    return articleTitle;
  }, [articleRecordTitle, articleTitle]);

  useEffect(() => {
    const title = stickyBarTitle?.trim();
    if (!title) return;
    document.title = title;
  }, [stickyBarTitle]);
  const tocItems = useMemo((): TocItem[] => {
    const items: TocItem[] = [];
    if (article?.blocks?.length) {
      article.blocks.forEach((block, index) => {
        if (!block.type.startsWith("heading")) return;
        const raw = block.text ?? "";
        const text = normalizeHeadingText(raw);
        if (!text) return;
        const rawLevel = rawHeadingLevelFromApiBlock(block);
        const level = displayHeadingLevel(rawLevel, headingLevelMap);
        if (level > TOC_MAX_DISPLAY_LEVEL) return;
        const prefix = headingNumberByBlockIndex.get(index);
        const textWithIndex = prefix ? `${prefix} ${text}` : text;
        items.push({
          id: buildHeadingId(raw, index),
          text: textWithIndex,
          level,
        });
      });
      return items;
    }

    articleBlocks.forEach((block, index) => {
      if (block.type !== "heading") return;
      const text = normalizeHeadingText(block.text);
      if (!text) return;
      const level = displayHeadingLevel(block.level, headingLevelMap);
      if (level > TOC_MAX_DISPLAY_LEVEL) return;
      const prefix = headingNumberByBlockIndex.get(index);
      const textWithIndex = prefix ? `${prefix} ${text}` : text;
      items.push({
        id: buildHeadingId(block.text, index),
        text: textWithIndex,
        level,
      });
    });
    return items;
  }, [article, articleBlocks, headingLevelMap, headingNumberByBlockIndex]);
  const coverTags = useMemo(
    () =>
      Array.from(
        new Set((article?.tags ?? []).map((item) => item.trim()).filter(Boolean))
      ).slice(0, 6),
    [article?.tags]
  );
  const coverMetaText = useMemo(() => {
    const line = article?.coverMetaLine?.trim();
    if (line) return line;
    return coverTags.join(" · ");
  }, [article?.coverMetaLine, coverTags]);
  const [activeTocId, setActiveTocId] = useState<string>("");
  const [titleStuck, setTitleStuck] = useState(false);
  const titleSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const dismissSplash = useCallback(() => {
    setSplashVisible(false);
  }, []);

  useEffect(() => {
    if (!splashVisible || isFetching) return;
    const t = window.setTimeout(() => dismissSplash(), 600);
    return () => window.clearTimeout(t);
  }, [dismissSplash, isFetching, splashVisible]);

  useEffect(() => {
    if (!titleSentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setTitleStuck(!entry.isIntersecting);
      },
      { threshold: 0, rootMargin: "-60px 0px 0px 0px" }
    );
    observer.observe(titleSentinelRef.current);
    return () => observer.disconnect();
  }, [mounted]);

  useEffect(() => {
    setActiveTocId(tocItems[0]?.id ?? "");
    if (!tocItems.length) return;
    const headings = tocItems
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!headings.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) =>
              Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top)
          );
        if (visible[0]?.target?.id) {
          setActiveTocId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-140px 0px -65% 0px",
        threshold: [0, 0.1, 0.3, 0.6, 1],
      }
    );

    headings.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [tocItems]);

  useEffect(() => {
    let cancelled = false;

    const loadArticle = async () => {
      setSplashVisible(true);
      setIsFetching(true);
      setLoading(true);
      setStreamComplete(false);
      setError(null);
      setArticle(null);
      setArticleBgStaticUrl(null);
      setArticleRecordTitle(null);
      setArticleSubtitle(null);
      setArticleSummary(null);

      try {
        let docsUrl = "";
        let documentId = "";
        const recordId = (recordIdFromQuery || slug).trim();
        let articleApiUrl = "";

        if (debugEnabled) {
          const query = new URLSearchParams({
            debug: "1",
            stream: "1",
          });
          if (debugDocsUrl) {
            query.set("debugDocsUrl", debugDocsUrl);
          }
          articleApiUrl = `/api/article?${query.toString()}`;
          docsUrl = debugDocsUrl ?? "";
          documentId = debugDocsUrl ? extractDocumentId(debugDocsUrl) ?? "" : "";
        } else {
          const playbookCacheKey = `slug=${slug}|rid=${recordIdFromQuery || ""}`;
          const cachedRecord = getCachedPlaybookRecord(playbookCacheKey);

          if (cachedRecord) {
            setArticleRecordTitle(
              (cachedRecord.fields?.["Title"] as string) ||
                (cachedRecord.fields?.["title"] as string) ||
                null
            );
            setArticleSubtitle(
              (cachedRecord.fields?.["Subtitle"] as string) ||
                (cachedRecord.fields?.["subtitle"] as string) ||
                null
            );
            setArticleSummary(
              (cachedRecord.fields?.["Summary"] as string) ||
                (cachedRecord.fields?.["summary"] as string) ||
                null
            );
            setArticleBgStaticUrl(
              bgStaticAttachmentUrlFromFields(cachedRecord.fields as Record<string, unknown>)
            );
            docsUrl = pickArticleDocsUrl(cachedRecord.fields as Record<string, unknown>) ?? "";
            documentId = extractDocumentId(docsUrl) ?? "";
          } else {
            // 不阻塞正文加载：Playbook 元信息在后台补齐
            void (async () => {
              try {
                const playbookRes = await fetch(
                  `/api/playbook?${new URLSearchParams({
                    slug,
                    ...(recordIdFromQuery ? { recordId: recordIdFromQuery } : {}),
                  }).toString()}`
                );
                const playbookResult = await playbookRes.json();
                if (!playbookResult.ok) return;
                const record = playbookResult.data;
                if (cancelled) return;
                setCachedPlaybookRecord(playbookCacheKey, record);
                setArticleRecordTitle(
                  (record.fields["Title"] as string) || (record.fields["title"] as string) || null
                );
                setArticleSubtitle(
                  (record.fields["Subtitle"] as string) ||
                    (record.fields["subtitle"] as string) ||
                    null
                );
                setArticleSummary(
                  (record.fields["Summary"] as string) ||
                    (record.fields["summary"] as string) ||
                    null
                );
                setArticleBgStaticUrl(
                  bgStaticAttachmentUrlFromFields(record.fields as Record<string, unknown>)
                );
              } catch {
                // ignore
              }
            })();
          }

          // JSON 模式（可缓存），避免每次路由切换都走 stream & 解析
          articleApiUrl = `/api/article?appToken=${APP_TOKEN}&tableId=${TABLE_ID}&recordId=${encodeURIComponent(recordId)}`;
        }

        if (!debugEnabled) {
          const cached = getCachedArticle(recordId);
          if (cached) {
            setArticle(cached);
            setLoading(false);
            setStreamComplete(true);
          }
        }

        const articleRes = await fetch(articleApiUrl);
        if (!articleRes.ok) throw new Error(`HTTP ${articleRes.status}`);

        if (debugEnabled && articleRes.body) {
          // debug 仍保留流式（便于独立调试 docs）
          const reader = articleRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done || cancelled) break;
            buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              const msg = JSON.parse(line) as {
                type: string;
                data?: ArticleApiData;
                error?: string;
                recordId?: string;
                docsUrl?: string;
                documentId?: string;
                docTitle?: string;
                debug?: boolean;
                content?: string;
                imageUrls?: string[];
                blocks?: ArticleApiData["blocks"];
                tags?: string[];
                coverMetaLine?: string;
              };

              if (cancelled) break;
              if (msg.type === "partial") {
                setArticle({
                  recordId: msg.recordId ?? recordId,
                  docsUrl: msg.docsUrl ?? docsUrl,
                  documentId: msg.documentId ?? documentId,
                  docTitle: msg.docTitle,
                  debug: msg.debug,
                  content: msg.content ?? "",
                  imageUrls: msg.imageUrls ?? [],
                  blocks: msg.blocks,
                  tags: msg.tags ?? [],
                  coverMetaLine: msg.coverMetaLine,
                  partial: true,
                });
                setLoading(false);
              } else if (msg.type === "complete") {
                setArticle(msg.data ?? null);
                setStreamComplete(true);
                setLoading(false);
              } else if (msg.type === "error") {
                setError(msg.error ?? "加载文章失败");
                setLoading(false);
              }
            }
          }
        } else {
          const articleJson = (await articleRes.json()) as { ok: boolean; data?: ArticleApiData; error?: string };
          if (!articleJson.ok || !articleJson.data) throw new Error(articleJson.error || "加载文章失败");
          if (!cancelled) {
            setArticle(articleJson.data);
            setCachedArticle(recordId, articleJson.data);
            setStreamComplete(true);
            setLoading(false);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      } finally {
        if (!cancelled) {
          setIsFetching(false);
        }
      }
    };

    loadArticle();
    return () => {
      cancelled = true;
    };
  }, [debugDocsUrl, debugEnabled, recordIdFromQuery, slug]);

  if (!mounted) {
    return <ArticleSsrFallback bgShader={bgShader} />;
  }

  if (error && !article) {
    return <ArticleErrorState errorMessage={error} />;
  }

  return (
    <div className="relative min-h-screen bg-white pb-16">
      {splashVisible ? (
        <ArticleSplashOverlay />
      ) : null}
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
      <div className="relative w-full px-3 sm:px-5 lg:px-6">
        <ArticleStickyTitleBar
          visible={titleStuck}
          articleTitle={stickyBarTitle}
          docsUrl={article?.docsUrl}
        />

        <ArticleHeroCover
          titleSentinelRef={titleSentinelRef}
          stickyVisible={titleStuck}
          article={article}
          coverMetaText={coverMetaText}
          articleRecordTitle={articleRecordTitle}
          articleTitle={articleTitle}
          articleSubtitle={articleSubtitle}
          articleSummary={articleSummary}
          articleBgStaticUrl={articleBgStaticUrl}
        />

        <div className="relative mt-24 lg:pl-[240px] lg:pr-4">
          <ArticleTocAside tocItems={tocItems} activeTocId={activeTocId} />

          <article className="mx-auto max-w-[860px]">
            {loading && !article && <ArticleBodyPreviewSkeleton />}

            {article && (
              <ArticleContent article={article} blocks={articleBlocks} />
            )}

            <ArticleStreamFooter visible={Boolean(article?.partial && !streamComplete)} />
          </article>
        </div>

        <ArticlePageFooter />
      </div>
    </div>
  );
}

export default function ArticlePageWithBoundary() {
  return (
    <ErrorBoundary>
      <ArticlePage />
    </ErrorBoundary>
  );
}
