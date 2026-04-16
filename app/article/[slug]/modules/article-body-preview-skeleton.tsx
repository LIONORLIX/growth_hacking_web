/**
 * 首屏正文骨架：文章尚未返回时，在内容区内展示标题行与段落、图片占位。
 */
import styles from "./article-prose.module.css";
import sk from "./article-skeleton.module.css";

export function ArticleBodyPreviewSkeleton() {
  return (
    <section className="space-y-4">
      <div className={`${styles.content} ${styles.docPreset}`}>
        <div className={styles.heading2}>
          <div className={sk.skeletonLine} style={{ width: "42%" }} />
        </div>
        <p className={styles.textBlock}>
          <span className={sk.skeletonLine} style={{ width: "96%" }} />
        </p>
        <p className={styles.textBlock}>
          <span className={sk.skeletonLine} style={{ width: "88%" }} />
        </p>
        <div className={styles.imageBlockWrap}>
          <div className={sk.skeletonImageArea} />
        </div>
      </div>
    </section>
  );
}
