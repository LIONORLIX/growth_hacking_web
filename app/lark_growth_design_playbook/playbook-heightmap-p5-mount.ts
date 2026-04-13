/**
 * 与首页 Hero 相同的高度图 + ramp shader，用固定像素尺寸挂载到任意 DOM。
 * 供「封面视频导出」等工具页使用；`preserveDrawingBuffer` 便于 canvas.captureStream 录到 WebGL 内容。
 */
import p5 from "p5";

import { heightmapRampFrag, heightmapRampVert } from "./heightmap-ramp-shaders";
import { heroHeightmapNoiseOrigin, heroHeightmapRampPixels } from "@/lib/hero-heightmap-ramp";

type P5Instance = InstanceType<typeof p5>;

type P5ShaderUniforms = {
  setUniform(name: string, data: number | number[] | boolean | object): void;
};

type P5GraphicsPixels = {
  pixels: number[] | Uint8ClampedArray;
  loadPixels(): void;
  updatePixels(): void;
};

export type PlaybookHeightmapP5Config = {
  rampWidth: number;
  rampSmoothSpread: number;
  pixelDensity: number;
  noiseScale: number;
  timeScale: number;
  waveAmplitude: number;
  waveOmega: readonly [number, number];
  waveSpatial: readonly [number, number, number, number];
  waveSecondary: number;
  grain: number;
};

/** 导出封面视频：略提高 ramp 宽度，其余与列表卡 shader 配置对齐 */
export const PLAYBOOK_COVER_EXPORT_HEIGHTMAP: PlaybookHeightmapP5Config = {
  rampWidth: 640,
  rampSmoothSpread: 2,
  pixelDensity: 1,
  noiseScale: 0.3,
  timeScale: 0.00012,
  waveAmplitude: 0.2,
  waveOmega: [1.08, 0.92],
  waveSpatial: [2.15, 1.65, 1.9, 2.28],
  waveSecondary: 0.48,
  grain: 0.03,
};

function buildRampGraphics(
  p: P5Instance,
  seed: string,
  rampWidth: number,
  themeBaseHex?: string | null,
  themeAccentHexes: string[] = [],
): P5GraphicsPixels {
  const g = p.createGraphics(rampWidth, 1);
  g.pixelDensity(1);
  const px = heroHeightmapRampPixels(seed, rampWidth, themeBaseHex, themeAccentHexes);
  g.loadPixels();
  for (let i = 0; i < px.length; i += 1) {
    g.pixels[i] = px[i];
  }
  g.updatePixels();
  return g;
}

export type MountPlaybookHeightmapP5Result = {
  remove: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  resize: (w: number, h: number) => void;
};

export function mountPlaybookHeightmapP5(
  host: HTMLElement,
  seed: string,
  opts: {
    width: number;
    height: number;
    /** 默认 true，供 MediaRecorder / captureStream */
    preserveDrawingBuffer?: boolean;
    cfg?: Partial<PlaybookHeightmapP5Config>;
    /** 与首页 Hero 一致：多维表 theme 基准色 */
    themeBaseHex?: string | null;
    /** 与首页 Hero 一致：多维表 theme 辅助色 */
    themeAccentHexes?: string[];
  },
): MountPlaybookHeightmapP5Result {
  const cfg: PlaybookHeightmapP5Config = { ...PLAYBOOK_COVER_EXPORT_HEIGHTMAP, ...opts.cfg };
  const w0 = Math.max(2, Math.floor(opts.width));
  const h0 = Math.max(2, Math.floor(opts.height));
  const preserve = opts.preserveDrawingBuffer !== false;
  const [noiseOx, noiseOy] = heroHeightmapNoiseOrigin(seed);
  const rampDu = cfg.rampSmoothSpread / cfg.rampWidth;

  let instance: P5Instance | null = null;

  const sketch = (p: P5Instance) => {
    let bgShader: P5ShaderUniforms;
    let ramp: P5GraphicsPixels;

    p.setup = () => {
      // p5 2.x：须先 WEBGL createCanvas，再 setAttributes；否则会调 _renderer._setAttributes 报错
      p.createCanvas(w0, h0, p.WEBGL);
      if (preserve) {
        const inst = p as unknown as { setAttributes?: (attrs: Record<string, boolean>) => void };
        inst.setAttributes?.({ preserveDrawingBuffer: true });
      }
      p.pixelDensity(cfg.pixelDensity);
      p.noStroke();
      ramp = buildRampGraphics(
        p,
        seed,
        cfg.rampWidth,
        opts.themeBaseHex,
        opts.themeAccentHexes ?? [],
      );
      bgShader = p.createShader(heightmapRampVert, heightmapRampFrag) as P5ShaderUniforms;
    };

    p.draw = () => {
      const t = p.millis() * cfg.timeScale;
      p.shader(bgShader as never);
      bgShader.setUniform("uRampTex", ramp);
      bgShader.setUniform("uResolution", [p.width, p.height]);
      bgShader.setUniform("uFlow", [noiseOx, noiseOy, t]);
      bgShader.setUniform("uWaveAmp", cfg.waveAmplitude);
      bgShader.setUniform("uWaveOmega", [...cfg.waveOmega]);
      bgShader.setUniform("uWaveSpatial", [...cfg.waveSpatial]);
      bgShader.setUniform("uWaveSecondary", cfg.waveSecondary);
      bgShader.setUniform("uNoiseScale", cfg.noiseScale);
      bgShader.setUniform("uGrain", cfg.grain);
      bgShader.setUniform("uRampDu", rampDu);
      p.plane(p.width, p.height);
    };
  };

  instance = new p5(sketch, host);

  return {
    remove: () => {
      instance?.remove();
      instance = null;
    },
    getCanvas: () => host.querySelector("canvas"),
    resize: (w: number, h: number) => {
      if (!instance) return;
      const ww = Math.max(2, Math.floor(w));
      const hh = Math.max(2, Math.floor(h));
      instance.resizeCanvas(ww, hh);
    },
  };
}
