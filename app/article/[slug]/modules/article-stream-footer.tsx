/**
 * 流式文末提示：partial 且流未结束时，在正文下方显示轻量加载条。
 */
import styles from "./article-skeleton.module.css";

export function ArticleStreamFooter({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className={styles.skeletonCallout}>
      <div className={styles.skeletonLine} style={{ width: "32%" }} />
      <div className={styles.skeletonLineShort} />
    </div>
  );
}
