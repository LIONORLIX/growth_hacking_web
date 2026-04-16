/**
 * 流式/占位骨架：高亮块与多列网格在内容未到时展示的灰色占位条。
 */
import styles from "./article-skeleton.module.css";

export function ArticleSkeletonCallout() {
  return (
    <div className={styles.skeletonCallout}>
      <div className={styles.skeletonLine} style={{ width: "80%" }} />
      <div className={styles.skeletonLine} style={{ width: "60%" }} />
    </div>
  );
}

export function ArticleSkeletonGrid({ cols }: { cols: number }) {
  return (
    <div
      className={styles.skeletonGrid}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
    >
      {Array.from({ length: cols }).map((_, i) => (
        <div key={i} className={styles.skeletonGridCol}>
          <div className={styles.skeletonImageArea} />
          <div className={styles.skeletonLine} style={{ width: "70%" }} />
          <div className={styles.skeletonLineShort} />
        </div>
      ))}
    </div>
  );
}
