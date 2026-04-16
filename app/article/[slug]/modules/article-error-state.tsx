/**
 * 加载失败空白页：居中显示错误码与报错信息，并提供返回首页按钮。
 */
import Link from "next/link";
import styles from "./article-error-state.module.css";

function pickErrorCode(message: string): string {
  const http = message.match(/HTTP\s*(\d{3})/i)?.[1];
  if (http) return http;
  const status = message.match(/status[:\s]+(\d{3})/i)?.[1];
  if (status) return status;
  return "UNKNOWN";
}

export function ArticleErrorState({ errorMessage }: { errorMessage: string }) {
  const code = pickErrorCode(errorMessage);
  return (
    <div className={styles.errorPage}>
      <section className={styles.errorInner}>
        <h1 className={styles.errorCode}>错误码：{code}</h1>
        <p className={styles.errorMessage}>{errorMessage}</p>
        <Link href="/" className={styles.homeButton}>
          返回首页
        </Link>
      </section>
    </div>
  );
}
