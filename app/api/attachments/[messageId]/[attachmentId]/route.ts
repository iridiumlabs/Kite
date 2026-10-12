import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { devAuthEnabled, signDevToken } from "@/lib/devAuth";

export const runtime = "nodejs";
export const maxDuration = 60;

function contentDisposition(
  filename: string,
  inline: boolean,
): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/'/g, "%27");
  const kind = inline ? "inline" : "attachment";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ messageId: string; attachmentId: string }> },
) {
  let token: string | null = null;
  try {
    const a = await auth();
    token = await a.getToken({ template: "convex" });
  } catch {
    token = null;
  }
  if (!token && devAuthEnabled()) {
    token = signDevToken(300);
  }
  if (!token) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { messageId, attachmentId } = await ctx.params;
  const client = new ConvexHttpClient(
    process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
  );
  client.setAuth(token);

  let result: {
    filename: string;
    contentType: string;
    size: number;
    data: ArrayBuffer;
  };
  try {
    result = (await client.action(api.content.downloadAttachment, {
      messageId: messageId as Id<"messages">,
      attachmentId,
    })) as typeof result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Download failed";
    const status = /not found/i.test(msg) ? 404 : 502;
    return new NextResponse(msg, { status });
  }

  // SVG is an active document when opened directly on the app origin.
  const inline = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"]).has(result.contentType.toLowerCase());
  return new NextResponse(result.data, {
    headers: {
      "Content-Type": result.contentType || "application/octet-stream",
      "Content-Length": String(result.size ?? result.data.byteLength),
      "Content-Disposition": contentDisposition(
        result.filename || "attachment",
        inline,
      ),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline';",
      "Cache-Control": "private, max-age=60",
    },
  });
}
