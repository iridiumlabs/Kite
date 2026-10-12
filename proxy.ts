import { clerkMiddleware } from "@clerk/nextjs/server";

// The dev-auth harness replaces Clerk entirely for local end-to-end testing;
// in that mode the middleware is a pass-through. Never set KITE_DEV_AUTH in
// production.
const devAuth =
  process.env.NODE_ENV === "development" &&
  process.env.KITE_DEV_AUTH === "1";

function passthrough() {
  return;
}

export default devAuth ? passthrough : clerkMiddleware();

export const config = {
  matcher: [
    // /api/mcp authenticates with Kite API keys, not Clerk sessions.
    "/((?!_next|api/mcp|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api(?!/mcp(?:/|$))|trpc)(.*)",
  ],
};
