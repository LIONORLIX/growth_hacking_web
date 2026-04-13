import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Playbook 卡片封面视频导出",
  description: "基于 p5 WebGL 高度图 shader 为每条记录录制封面 WebM 视频（内部工具）。",
  robots: { index: false, follow: false },
};

export default function CardCoverVideoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
