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
    blockquote {
      margin: 0 0 14px;
      padding-left: 10px;
      border-left: 2px solid #0000001f;
      color: #6e6e73;
    }
    pre { white-space: pre-wrap; }
  </style>
`;

function frameDoc(html: string, dark: boolean) {
  const darkCss = dark
    ? `<style>body{background:#ffffff;border-radius:8px;padding:8px;}</style>`
    : "";
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:;">
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

function QuotedBlock({ children, html }: { children?: string; html?: string }) {
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
          <div
            className="mt-2 text-secondary"
            dangerouslySetInnerHTML={{ __html: html }}
          />
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
}: {
  content: MessageContent | undefined;
  dark?: boolean;
  maxChars?: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [loaded, setLoaded] = useState(false);

  const html = content?.html;
  const text = content?.text;

  const [prevHtml, setPrevHtml] = useState(html);
  if (prevHtml !== html) {
    setPrevHtml(html);
    setLoaded(false);
    setHeight(120);
  }

  useEffect(() => {
    if (!loaded || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    const measure = () => {
      if (iframeRef.current?.contentDocument) {
        const h = iframeRef.current.contentDocument.documentElement
          .scrollHeight;
        if (h > 0) setHeight(h);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(doc.documentElement);
    return () => ro.disconnect();
  }, [loaded]);

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
          srcDoc={frameDoc(truncated, dark)}
          style={{ height }}
          onLoad={() => setLoaded(true)}
        />
        {content?.quotedHtml && (
          <QuotedBlock html={content.quotedHtml} />
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
