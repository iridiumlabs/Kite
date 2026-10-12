"use client";

import { useEffect, useRef, useState } from "react";
import type { MessageContent } from "@/lib/ui/types";

const FRAME_STYLE = `
  <style>
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI",
        Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 22px;
      color: #1d1d1f;
      word-wrap: break-word;
    }
    a { color: #007aff; text-decoration: none; }
    img { max-width: 100%; height: auto; }
    p { margin: 0 0 14px; }
    ul, ol { margin: 0 0 14px; padding-left: 20px; }
    ul { list-style: disc; }
    ol { list-style: decimal; }
    li + li { margin-top: 6px; }
    li::marker { color: #8a8a8e; }
    blockquote {
      margin: 0 0 14px;
      padding-left: 10px;
      border-left: 2px solid #0000001f;
      color: #6e6e73;
    }
    pre { white-space: pre-wrap; }
  </style>
`;

function frameDoc(html: string, dark: boolean, loadRemoteImages: boolean) {
  const darkCss = dark
    ? `<style>body{background:#ffffff;border-radius:8px;padding:8px;}</style>`
    : "";
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${loadRemoteImages ? "https: " : ""}data:; style-src 'unsafe-inline'; font-src 'self' data:;">
<base target="_blank">
${FRAME_STYLE}${darkCss}
</head><body>${html}</body></html>`;
}

function linkify(text: string) {
  const urlRe = /(https?:\/\/[^\s<>"']+)/g;
  const parts = text.split(urlRe);
  return parts.map((part, i) =>
    urlRe.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function QuotedBlock({ children, html, loadRemoteImages }: { children?: string; html?: string; loadRemoteImages?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        className="quoted-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Show quoted text"
      >
        •••
      </button>
      {open &&
        (html ? (
          <div className="mt-2 text-secondary">
            <MessageBody content={{ html, loadRemoteImages }} />
          </div>
        ) : (
          <div className="mt-2 whitespace-pre-wrap text-secondary text-sm/5.5">
            {children}
          </div>
        ))}
    </div>
  );
}

export function MessageBody({
  content,
  dark = false,
  maxChars,
  onRetry,
}: {
  content: MessageContent | undefined;
  dark?: boolean;
  maxChars?: number;
  onRetry?: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const html = content?.html;
  const text = content?.text;

  const [prevHtml, setPrevHtml] = useState(html);
  if (prevHtml !== html) {
    setPrevHtml(html);
    setHeight(120);
  }

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame || !html) return;
    let observer: ResizeObserver | undefined;
    let disposed = false;
    const initialize = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      observer?.disconnect();
      const faces: string[] = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.type === CSSRule.FONT_FACE_RULE) {
              // Font URLs are relative to their stylesheet, not the mail route.
              faces.push(rule.cssText.replace(/url\(([^)]+)\)/g, (_, url: string) =>
                `url("${new URL(url.trim().replace(/^['"]|['"]$/g, ""), sheet.href ?? document.baseURI).href}")`));
            }
          }
        } catch { /* Cross-origin stylesheets cannot be inspected. */ }
      }
      const style = doc.getElementById("kite-fonts") ?? doc.createElement("style");
      style.id = "kite-fonts";
      style.textContent = `${faces.join("\n")} body { font-family: ${getComputedStyle(document.body).fontFamily}; }`;
      if (!style.isConnected) doc.head.append(style);
      const measure = () => {
        if (disposed || frame.contentDocument !== doc) return;
        // Measuring the body lets the frame shrink as well as grow. The root's
        // scrollHeight is at least the current iframe viewport height.
        const h = Math.ceil(Math.max(doc.body.scrollHeight, doc.body.getBoundingClientRect().height));
        if (h > 0) setHeight(h);
      };
      observer = new ResizeObserver(measure);
      observer.observe(doc.body);
      measure();
      void doc.fonts.ready.then(measure);
    };
    frame.addEventListener("load", initialize);
    // An SSR srcdoc can finish loading before React hydrates its onLoad handler.
    if (frame.contentDocument?.readyState === "complete") initialize();
    return () => {
      disposed = true;
      observer?.disconnect();
      frame.removeEventListener("load", initialize);
    };
  }, [html, dark, content?.loadRemoteImages]);
  if (html) {
    const truncated =
      maxChars && html.length > maxChars ? html.slice(0, maxChars) : html;
    return (
      <div className={dark ? "rounded-lg overflow-hidden" : undefined}>
        <iframe
          ref={iframeRef}
          title="Message"
          className="body-frame"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={frameDoc(truncated, dark, content?.loadRemoteImages ?? false)}
          style={{ height }}
        />
        {content?.quotedHtml && (
          <QuotedBlock html={content.quotedHtml} loadRemoteImages={content.loadRemoteImages} />
        )}
      </div>
    );
  }

  if (content?.error !== undefined) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-divider px-3 py-2.5">
        <div className="grow text-tertiary text-[13px]/4">
          {content.error}
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="pressable shrink-0 font-medium text-accent text-[13px]/4"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  if (text !== undefined) {
    const truncated =
      maxChars && text.length > maxChars ? text.slice(0, maxChars) : text;
    return (
      <div>
        <div className="whitespace-pre-wrap text-primary text-sm/5.5 wrap-anywhere">
          {linkify(truncated)}
        </div>
        {content?.quotedText && (
          <QuotedBlock>{content.quotedText}</QuotedBlock>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" aria-label="Loading">
      <div className="skeleton h-4 w-11/12" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-4/5" />
      <div className="skeleton h-4 w-2/3" />
    </div>
  );
}
