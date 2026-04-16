"use client";

/**
 * 懒加载图片：进入视口后再请求，加载前显示骨架；点击已加载图打开灯箱。
 */
import { useEffect, useRef, useState } from "react";
import { ArticleImageLightbox } from "./article-image-lightbox";
import lazyStyles from "./article-lazy-image.module.css";

export function ArticleLazyImage({
  src,
  alt,
  className,
}: {
  src?: string;
  alt: string;
  className: string;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!wrapRef.current) return;
    if (!src) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px 0px" }
    );

    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [src]);

  return (
    <div ref={wrapRef} className={lazyStyles.lazyImageWrap}>
      {!isLoaded && <div className={lazyStyles.lazyImageSkeleton} />}
      {isVisible && src ? (
        <img
          src={src}
          alt={alt}
          className={`${className} ${lazyStyles.lazyImage} ${
            isLoaded ? lazyStyles.lazyImageLoaded : ""
          }`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setIsLoaded(true)}
          onClick={() => isLoaded && setLightbox(true)}
          style={{ cursor: isLoaded ? "zoom-in" : undefined }}
        />
      ) : null}
      {lightbox && src && (
        <ArticleImageLightbox
          src={src}
          alt={alt}
          onClose={() => setLightbox(false)}
        />
      )}
    </div>
  );
}
