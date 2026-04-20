"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import Link from "next/link";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught render error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          style={{
            minHeight: "100vh",
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem 1.25rem",
          }}
        >
          <div style={{ width: "min(760px, 100%)", textAlign: "center" }}>
            <h1
              style={{
                margin: "0 0 0.85rem",
                color: "#111",
                fontSize: "clamp(1.4rem, 3vw, 2rem)",
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              页面发生错误
            </h1>
            <p
              style={{
                margin: 0,
                color: "#555",
                fontSize: "1rem",
                lineHeight: 1.75,
              }}
            >
              {this.state.error?.message || "未知错误"}
            </p>
            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: "1.5rem",
                padding: "0.56rem 1.2rem",
                border: "1.5px solid #111",
                borderRadius: "9999px",
                color: "#111",
                background: "linear-gradient(180deg, #fff 0%, #f7f7f7 100%)",
                fontSize: "0.95rem",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              返回首页
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
