import { NextResponse } from "next/server";
import { devAuthEnabled, jwks } from "@/lib/devAuth";

export const runtime = "nodejs";

export async function GET() {
  if (!devAuthEnabled()) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json(jwks(), {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
