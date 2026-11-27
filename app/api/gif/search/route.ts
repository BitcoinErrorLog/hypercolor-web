import { NextRequest, NextResponse } from "next/server";
import {
  appendGifSessionCookies,
  bindGifSession,
  clientIpFromHeaders,
  searchTenor,
} from "@/server/gif-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = bindGifSession(request.headers.get("cookie"));
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
  const ip = clientIpFromHeaders(request.headers);
  const result = await searchTenor(q, session.sid, ip, {
    limit: parsedLimit,
    origin: request.nextUrl.origin,
  });
  const res = NextResponse.json(result.body, { status: result.status });
  appendGifSessionCookies(res.headers, session);
  return res;
}
