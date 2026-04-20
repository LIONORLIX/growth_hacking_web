"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArticleImageLightbox } from "./article-image-lightbox";
import lazyStyles from "./article-lazy-image.module.css";

export function ArticleLazyImage({
  src,
  alt,
  className,
  priority = false,
}: {
  src?: string;
  alt: string;
  className: string;
  priority?: boolean;
}) {
  const [isVisible, setIsVisible] = useState(priority);
  const [isLoaded, setIsLoaded] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const linkRef = useRef<HTMLLinkElement | null>(null);

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const entry = entries[0];
      if (entry?.isIntersecting) {
        setIsVisible(true);
        if (observerRef.current) {
          observerRef.current.disconnect();
          observerRef.current = null;
        }
      }
    },
    []
  );

  useEffect(() => {
    if (priority) return;
    if (!src) return;

    linkRef.current = document.createElement("link");
    linkRef.current.rel = "preconnect";
    linkRef.current.href = new URL(src, window.location.origin).origin;
    document.head.appendChild(linkRef.current);
  }, [src, priority]);

  useEffect(() => {
    if (priority) return;
    if (!wrapRef.current) return;
    if (!src) return;

    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(handleIntersection, {
      rootMargin: "480px 0px",
    });

    observerRef.current = observer;
    observer.observe(wrapRef.current);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [src, priority, handleIntersection]);

  useEffect(() => {
    return () => {
      if (linkRef.current) {
        document.head.removeChild(linkRef.current);
      }
    };
  }, []);

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
          loading={priority ? "eager" : "lazy"}
          referrerPolicy="no-referrer"
          decoding="async"
          fetchPriority={priority ? "high" : "low"}
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
