import { NextResponse } from "next/server";
import { devAuthEnabled, signDevToken } from "@/lib/devAuth";

export const runtime = "nodejs";

export async function GET() {
  if (!devAuthEnabled()) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json({ token: signDevToken(3600) });
}
