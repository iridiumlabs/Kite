const FRAME_STYLE = `
  <style>
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI",
        Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 22px;
      color: #1d1d1f;
      overflow-wrap: break-word;
    }
    #kite-message-content { display: flow-root; width: 100%; }
    #kite-message-content > :is(table, div, center) {
      margin-inline: auto !important;
      max-width: 100% !important;
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

/** HTML is already sanitized by the backend. Keep scripts and remote resources blocked. */
export function messageFrameDoc(html: string, dark: boolean, loadRemoteImages: boolean) {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="color-scheme" content="${dark ? "dark" : "light"}">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${loadRemoteImages ? "https: " : ""}data:; style-src 'unsafe-inline'; font-src 'self' data:;">
<base target="_blank">
${FRAME_STYLE}
${dark ? "<style>html,body{background:#1c1c1e;}</style>" : ""}
</head><body><div id="kite-message-content">${html}</div></body></html>`;
}

function rgb(css: string) {
  const match = css.match(/^rgba?\((.+)\)$/);
  if (!match) return undefined;
  const values = match[1].match(/[\d.]+/g)?.map(Number);
  if (!values || values.length < 3) return undefined;
  const [r, g, b, alpha = 1] = values;
  return { r, g, b, alpha, neutral: Math.max(r, g, b) - Math.min(r, g, b) <= 24, lightness: (r + g + b) / 3 };
}

/** Only adapt neutral surfaces; never invert photos or saturated brand colours. */
export function darkMessageBackground(css: string): string | undefined {
  const color = rgb(css);
  if (!color || color.alpha !== 1 || !color.neutral || color.lightness < 140) return undefined;
  const level = 28 + Math.round((255 - color.lightness) * 0.2);
  return `rgb(${level}, ${level}, ${level + 2})`;
}

export function darkMessageForeground(css: string): string | undefined {
  const color = rgb(css);
  if (!color || !color.neutral || color.lightness >= 190) return undefined;
  const level = 245 - Math.round(color.lightness * 0.45);
  return `rgba(${level}, ${level}, ${level + 2}, ${color.alpha})`;
}

/** Runs in the parent, not inside the sandbox. Read original styles before writing
 * so inherited colours and legacy bgcolor/font attributes are handled consistently. */
export function adaptDarkMessage(doc: Document) {
  const view = doc.defaultView;
  if (!view || doc.documentElement.dataset.kiteDarkAdapted) return;
  doc.documentElement.dataset.kiteDarkAdapted = "true";
  const elements = [doc.body, ...doc.body.querySelectorAll<HTMLElement>("*")];
  const styles = elements.map(element => {
    const style = view.getComputedStyle(element);
    return { element, background: style.backgroundColor, image: style.backgroundImage, color: style.color };
  });
  const darkSurface = new Map<Element, boolean>();
  for (const { element, background, image, color } of styles) {
    const adaptedBackground = darkMessageBackground(background);
    const original = rgb(background);
    const transparent = !original || original.alpha === 0;
    const onDark = image === "none" && (transparent
      ? (element.parentElement ? (darkSurface.get(element.parentElement) ?? true) : true)
      : !!adaptedBackground || (original.neutral && original.lightness < 100));
    darkSurface.set(element, onDark);
    if (adaptedBackground && image === "none") {
      element.style.setProperty("background-color", adaptedBackground, "important");
    }
    if (onDark) {
      const foreground = darkMessageForeground(color);
      if (foreground) element.style.setProperty("color", foreground, "important");
    }
  }
}
