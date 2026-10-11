import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./model/auth";

const http = httpRouter();
http.route({
  path: "/send-attachment",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
    try { await requireUserId(ctx, authorization.slice(7)); }
    catch { return new Response("Unauthorized", { status: 401 }); }
    const max = 25 * 1024 * 1024;
    if (Number(request.headers.get("content-length")) > max) return new Response("Attachment too large", { status: 413 });
    const blob = await request.blob();
    if (blob.size > max) return new Response("Attachment too large", { status: 413 });
    const storageId = await ctx.storage.store(blob);
    // A lost client/send response must not delete inputs of an active action.
    await ctx.scheduler.runAfter(24 * 60 * 60 * 1000, internal.send.deleteTemporaryAttachment, { storageId });
    return Response.json({ storageId });
  }),
});
export default http;
