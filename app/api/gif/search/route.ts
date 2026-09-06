import { NextRequest, NextResponse } from "next/server";
import {
  clientIpFromHeaders,
  newGifSessionId,
  parseGifSessionCookie,
  searchTenor,
  sessionCookie,
} from "@/server/gif-proxy";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const parsed = parseGifSessionCookie(request.headers.get("cookie"));
  if (parsed.present && !parsed.valid) {
    return NextResponse.json({ error: "Invalid GIF session." }, { status: 401 });
  }
  let cookieValue = parsed.valid ? parsed.cookieValue : "";
  let sid = parsed.sid;
  const setCookie = !sid;
  if (!sid) {
    cookieValue = newGifSessionId();
    sid = parseGifSessionCookie(`hc_gif_sid=${cookieValue}`).sid;
  }
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const ip = clientIpFromHeaders(request.headers.get("x-forwarded-for"));
  const result = await searchTenor(q, sid, ip);
  const res = NextResponse.json(result.body, { status: result.status });
  if (setCookie && cookieValue) res.headers.append("Set-Cookie", sessionCookie(cookieValue));
  return res;
}
