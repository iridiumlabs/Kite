import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware();

export const config = {
  matcher: [
    // /api/mcp authenticates with Post API keys, not Clerk sessions.
    "/((?!_next|api/mcp|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api(?!/mcp(?:/|$))|trpc)(.*)",
  ],
};
