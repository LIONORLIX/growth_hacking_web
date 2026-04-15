"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getPlaybookAppToken, getPlaybookTableId } from "@/lib/playbook-data-source";
import {
  heroGradientSeedForRecord,
  playbookSlugFromFields,
  themeHexesFromFields,
} from "@/lib/hero-parametric-gradient";

type BaseRecord = {
  record_id: string;
  fields: {
    Title?: string;
    Slug?: string;
    slug?: string;
    [key: string]: unknown;
  };
};

type BaseData = {
  items: BaseRecord[];
  total: number;
  has_more: boolean;
};

function isPublishedRecord(item: BaseRecord): boolean {
  const raw = item.fields?.Status ?? item.fields?.status ?? item.fields?.STATUS;
  return typeof raw === "string" && raw.trim().toLowerCase() === "pub";
}

const APP_TOKEN = getPlaybookAppToken();
const TABLE_ID = getPlaybookTableId();

/** 与批量导出一致：给 React 重挂载 p5 / WebGL 首帧留出时间，避免 captureStream 前几帧为空。 */
const RECORD_SETTLE_MS = 900;

type ExportFormat = "auto" | "mp4" | "webm";
type MountedP5 = {
  remove: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  resize: (w: number, h: number) => void;
};

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("导出首帧失败：无法生成 PNG"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function pickVideoMimeType(format: ExportFormat): string | undefined {
  const mp4Candidates = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1", "video/mp4"];
  const webmCandidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const candidates =
    format === "mp4"
      ? mp4Candidates
      : format === "webm"
        ? webmCandidates
        : [...mp4Candidates, ...webmCandidates];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return undefined;
}

function safeFileSlug(record: BaseRecord): string {
  const raw = playbookSlugFromFields(record.fields) || record.fields.Title?.trim() || record.record_id;
  return raw.replace(/[^\w\u4e00-\u9fff-]+/g, "_").slice(0, 80);
}

function randomSeedToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export default function CardCoverVideoPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<MountedP5 | null>(null);

  const [data, setData] = useState<BaseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => data?.items.find((r) => r.record_id === selectedId) ?? null,
    [data, selectedId],
  );
  const seed = useMemo(
    () => (selected ? heroGradientSeedForRecord(selected) : ""),
    [selected],
  );
  const [overrideSeed, setOverrideSeed] = useState<string | null>(null);
  const effectiveSeed = overrideSeed ?? seed;
  const themeHexes = useMemo(
    () =>
      selected ? themeHexesFromFields(selected.fields as Record<string, unknown>) : [],
    [selected],
  );
  const themeHex = themeHexes[0] ?? null;
  const themeAccentHexes = themeHexes.slice(1);

  const [outW, setOutW] = useState(720);
  const [outH, setOutH] = useState(720);
  const [durationSec, setDurationSec] = useState(6);
  const [fps, setFps] = useState(24);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("auto");

  const [log, setLog] = useState("");
  const [recording, setRecording] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/test-feishu?action=base&appToken=${encodeURIComponent(APP_TOKEN)}&tableId=${encodeURIComponent(TABLE_ID)}`,
        );
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "拉取失败");
        if (!cancelled) {
          const raw = json.data as BaseData;
          const items = raw.items.filter(isPublishedRecord);
          setData({ ...raw, items, total: items.length, has_more: false });
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!data?.items.length) {
      setSelectedId(null);
      return;
    }
    const ok = selectedId && data.items.some((r) => r.record_id === selectedId);
    if (ok) return;
    setSelectedId(data.items[0]!.record_id);
  }, [data, selectedId]);

  useEffect(() => {
    setOverrideSeed(null);
  }, [selectedId]);

  /** 挂载 / 切换 seed 或输出尺寸 */
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !effectiveSeed) return undefined;
    let activeMount: MountedP5 | null = null;
    let disposed = false;
    mountRef.current?.remove();
    mountRef.current = null;
    host.innerHTML = "";
    void (async () => {
      const { mountPlaybookHeightmapP5 } = await import(
        "@/app/lark_growth_design_playbook/playbook-heightmap-p5-mount"
      );
      if (disposed) return;
      const m = mountPlaybookHeightmapP5(host, effectiveSeed, {
        width: outW,
        height: outH,
        preserveDrawingBuffer: true,
        themeBaseHex: themeHex,
        themeAccentHexes,
      });
      activeMount = m;
      mountRef.current = m;
    })();
    return () => {
      disposed = true;
      activeMount?.remove();
      if (mountRef.current === activeMount) mountRef.current = null;
    };
  }, [effectiveSeed, themeHex, themeAccentHexes, outW, outH]);

  const appendLog = useCallback((line: string) => {
    setLog((prev) => (prev ? `${prev}\n${line}` : line));
  }, []);

  /** 等待 mount effect 里异步挂载的 canvas 可用（单条录制无 setState 间隔时尤其需要）。 */
  const waitForMountCanvas = useCallback(async (timeoutMs = 12_000) => {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      const canvas = mountRef.current?.getCanvas();
      if (canvas && canvas.width > 0 && canvas.height > 0) return;
      await new Promise<void>((r) => {
        setTimeout(r, 50);
      });
    }
    throw new Error("画布未就绪：等待挂载超时，请稍后重试或切换记录后再录");
  }, []);

  const settleBeforeRecord = useCallback(
    () => new Promise<void>((r) => setTimeout(r, RECORD_SETTLE_MS)),
    [],
  );

  const recordCurrentToBlob = useCallback(async (): Promise<{
    blob: Blob;
    ext: "mp4" | "webm";
    mimeBase: string;
    firstFrameBlob: Blob;
  }> => {
    const webglCanvas = mountRef.current?.getCanvas();
    if (!webglCanvas) throw new Error("画布未就绪");
    
    // Create an invisible 2D canvas to intercept rendering.
    // Chromium has a known bug where WebGL captureStream produces empty or single-frame streams.
    const proxyCanvas = document.createElement("canvas");
    proxyCanvas.width = webglCanvas.width;
    proxyCanvas.height = webglCanvas.height;
    const ctx = proxyCanvas.getContext("2d");
    if (!ctx) throw new Error("无法初始化 2D 录制代理画布");

    const mime = pickVideoMimeType(exportFormat);
    if (!mime) {
      if (exportFormat === "mp4") throw new Error("当前浏览器不支持 MP4(H.264) 录制");
      if (exportFormat === "webm") throw new Error("当前浏览器不支持 WebM 录制");
      throw new Error("当前浏览器不支持 MP4/WebM 录制");
    }

    const stream = proxyCanvas.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });

    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    // 首次绘制后立即截取首帧，确保与视频开头一致。
    ctx.drawImage(webglCanvas, 0, 0);
    const firstFrameBlob = await canvasToPngBlob(proxyCanvas);

    let keepDrawing = true;
    const drawLoop = () => {
      if (!keepDrawing) return;
      ctx.drawImage(webglCanvas, 0, 0);
      requestAnimationFrame(drawLoop);
    };

    const stopped = new Promise<void>((resolve, reject) => {
      rec.onerror = () => { keepDrawing = false; reject(new Error("MediaRecorder 错误")); };
      rec.onstop = () => { keepDrawing = false; resolve(); };
    });

    requestAnimationFrame(drawLoop);
    rec.start(100);

    // Wait based on exact cumulative foreground duration, accurately fixing duration inaccuracies
    // caused by standard setTimeout when tab background rendering pauses.
    await new Promise<void>((resolve) => {
      let elapsedMs = 0;
      let lastLoopTime = performance.now();
      
      const check = (now: DOMHighResTimeStamp) => {
        if (!keepDrawing) return resolve();
        const delta = Math.min(100, now - lastLoopTime); // Exclude large background lag gaps
        lastLoopTime = now;
        elapsedMs += delta;
        if (elapsedMs >= durationSec * 1000) {
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      requestAnimationFrame((now) => { lastLoopTime = now; requestAnimationFrame(check); });
    });

    rec.stop();
    keepDrawing = false;
    await stopped;

    const mimeBase = mime.split(";")[0] || "video/webm";
    const ext: "mp4" | "webm" = mimeBase.includes("mp4") ? "mp4" : "webm";
    return { blob: new Blob(chunks, { type: mimeBase }), ext, mimeBase, firstFrameBlob };
  }, [durationSec, exportFormat, fps]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onRecordOne = async () => {
    if (!selected) return;
    setRecording(true);
    setLog("");
    try {
      await waitForMountCanvas();
      await settleBeforeRecord();
      const { blob, ext, mimeBase, firstFrameBlob } = await recordCurrentToBlob();
      const baseName = `playbook-cover-${safeFileSlug(selected)}-${selected.record_id}`;
      const videoName = `${baseName}.${ext}`;
      const frameName = `${baseName}-frame1.png`;
      downloadBlob(blob, videoName);
      downloadBlob(firstFrameBlob, frameName);
      appendLog(`已下载：${videoName} (${mimeBase})`);
      appendLog(`已下载：${frameName} (image/png)`);
    } catch (e) {
      appendLog(String(e));
    } finally {
      setRecording(false);
    }
  };

  const onBatch = async () => {
    if (!data?.items.length) return;
    setBatchRunning(true);
    setLog("");
    try {
      for (let i = 0; i < data.items.length; i += 1) {
        const item = data.items[i]!;
        setSelectedId(item.record_id);
        appendLog(`[${i + 1}/${data.items.length}] 准备 ${item.record_id} …`);
        await waitForMountCanvas();
        await settleBeforeRecord();
        const { blob, ext, mimeBase, firstFrameBlob } = await recordCurrentToBlob();
        const baseName = `playbook-cover-${safeFileSlug(item)}-${item.record_id}`;
        const videoName = `${baseName}.${ext}`;
        const frameName = `${baseName}-frame1.png`;
        downloadBlob(blob, videoName);
        downloadBlob(firstFrameBlob, frameName);
        appendLog(`已下载：${videoName} (${mimeBase})`);
        appendLog(`已下载：${frameName} (image/png)`);
      }
      appendLog("批量完成。");
    } catch (e) {
      appendLog(String(e));
    } finally {
      setBatchRunning(false);
    }
  };

  const onRegenerateSeed = () => {
    setOverrideSeed(randomSeedToken());
  };

  const onCopySeed = async () => {
    if (!effectiveSeed) return;
    try {
      await navigator.clipboard.writeText(effectiveSeed);
      appendLog(`已复制 seed：${effectiveSeed}`);
    } catch (e) {
      appendLog(`复制失败：${String(e)}`);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 border-b border-stone-200 pb-6">
          <p className="text-sm text-stone-500">
            <Link href="/lark_growth_design_playbook" className="text-stone-700 underline-offset-4 hover:underline">
              ← 返回 Playbook
            </Link>
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">卡片封面视频（p5 WebGL）</h1>
          <p className="mt-2 max-w-3xl text-sm text-stone-600">
            使用与首页相同的高度图 shader，按设定分辨率与时长导出
            <code className="mx-1 rounded bg-stone-200/80 px-1">.mp4</code>
            或
            <code className="mx-1 rounded bg-stone-200/80 px-1">.webm</code>。
            依赖浏览器 <code className="rounded bg-stone-200/80 px-1">canvas.captureStream</code> 与
            <code className="mx-1 rounded bg-stone-200/80 px-1">MediaRecorder</code> 能力。
          </p>
        </header>

        {loading ? <p className="text-stone-600">加载多维表…</p> : null}
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>
        ) : null}

        {!loading && !error && data ? (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">预览</h2>
              <div
                className="mt-2 overflow-hidden rounded-xl border border-stone-200 bg-black shadow-sm"
                style={{ aspectRatio: `${outW} / ${outH}`, maxHeight: "min(70vh, 720px)" }}
              >
                <div ref={hostRef} className="h-full w-full [&_canvas]:h-full [&_canvas]:w-full [&_canvas]:object-contain" />
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={recording || batchRunning || !selected}
                  onClick={() => void onRecordOne()}
                  className="rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-40"
                >
                  {recording ? "录制中…" : "录制当前并下载"}
                </button>
                <button
                  type="button"
                  disabled={!selected}
                  onClick={onRegenerateSeed}
                  className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 transition-opacity disabled:opacity-40"
                >
                  重新生成
                </button>
                <button
                  type="button"
                  disabled={!effectiveSeed}
                  onClick={() => void onCopySeed()}
                  className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 transition-opacity disabled:opacity-40"
                >
                  复制 Seed
                </button>
                <button
                  type="button"
                  disabled={recording || batchRunning || !data.items.length}
                  onClick={() => void onBatch()}
                  className="rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-800 transition-opacity disabled:opacity-40"
                >
                  {batchRunning ? "批量进行中…" : "按表顺序全部导出"}
                </button>
              </div>

              {log ? (
                <pre className="mt-4 max-h-48 overflow-auto rounded-lg border border-stone-200 bg-white p-3 text-xs text-stone-700">
                  {log}
                </pre>
              ) : null}
            </div>

            <aside className="space-y-6">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">记录</h2>
                <ul className="mt-2 max-h-[min(50vh,28rem)] space-y-1 overflow-y-auto rounded-lg border border-stone-200 bg-white p-1">
                  {data.items.map((r) => (
                    <li key={r.record_id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(r.record_id)}
                        className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                          r.record_id === selectedId ? "bg-stone-900 text-white" : "hover:bg-stone-100"
                        }`}
                      >
                        <span className="line-clamp-2">{r.fields.Title || r.record_id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-stone-800">输出</h2>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs text-stone-600">
                    宽 px
                    <input
                      type="number"
                      min={320}
                      max={3840}
                      disabled={recording || batchRunning}
                      value={outW}
                      onChange={(e) => setOutW(Number(e.target.value) || 720)}
                      className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs text-stone-600">
                    高 px
                    <input
                      type="number"
                      min={240}
                      max={2160}
                      disabled={recording || batchRunning}
                      value={outH}
                      onChange={(e) => setOutH(Number(e.target.value) || 720)}
                      className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs text-stone-600">
                    导出格式
                    <select
                      disabled={recording || batchRunning}
                      value={exportFormat}
                      onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                      className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="auto">自动（优先 MP4）</option>
                      <option value="mp4">MP4 (H.264)</option>
                      <option value="webm">WebM</option>
                    </select>
                  </label>
                  <label className="text-xs text-stone-600">
                    时长（秒）
                    <input
                      type="number"
                      min={1}
                      max={120}
                      step={0.5}
                      disabled={recording || batchRunning}
                      value={durationSec}
                      onChange={(e) => setDurationSec(Number(e.target.value) || 6)}
                      className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs text-stone-600">
                    帧率
                    <input
                      type="number"
                      min={15}
                      max={60}
                      disabled={recording || batchRunning}
                      value={fps}
                      onChange={(e) => setFps(Number(e.target.value) || 24)}
                      className="mt-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                </div>
                <p className="mt-3 text-xs text-stone-500">
                  当前 seed（与首页卡片一致）：<br />
                  <code className="mt-1 block break-all text-[11px] text-stone-700">{effectiveSeed || "—"}</code>
                </p>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
