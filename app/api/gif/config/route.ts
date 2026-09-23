import { NextResponse } from "next/server";
import { gifSearchConfigured } from "@/server/gif-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { configured: gifSearchConfigured() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
