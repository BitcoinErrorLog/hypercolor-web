import { NextRequest, NextResponse } from "next/server";
import {
  gifSessionIdFromCookie,
  newGifSessionId,
  searchTenor,
  sessionCookie,
} from "@/server/gif-proxy";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  let sid = gifSessionIdFromCookie(request.headers.get("cookie"));
  const setCookie = !sid;
  if (!sid) sid = newGifSessionId();
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const result = await searchTenor(q, sid);
  const res = NextResponse.json(result.body, { status: result.status });
  if (setCookie) res.headers.append("Set-Cookie", sessionCookie(sid));
  return res;
}
