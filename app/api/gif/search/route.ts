import { NextRequest, NextResponse } from "next/server";
import {
  appendGifSessionCookies,
  bindGifSession,
  clientIpFromHeaders,
  searchTenor,
} from "@/server/gif-proxy";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = bindGifSession(request.headers.get("cookie"));
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const ip = clientIpFromHeaders(request.headers);
  const result = await searchTenor(q, session.sid, ip);
  const res = NextResponse.json(result.body, { status: result.status });
  appendGifSessionCookies(res.headers, session);
  return res;
}
