import { NextRequest, NextResponse } from "next/server";
import {
  clientIpFromHeaders,
  fetchTenorGif,
  newGifSessionId,
  parseGifSessionCookie,
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
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const kind = request.nextUrl.searchParams.get("kind") === "preview" ? "preview" : "gif";
  const ip = clientIpFromHeaders(request.headers.get("x-forwarded-for"));
  const result = await fetchTenorGif(id, sid, kind, ip);
  if (result.status !== 200) {
    const res = NextResponse.json(result.body, { status: result.status });
    if (setCookie && cookieValue) res.headers.append("Set-Cookie", sessionCookie(cookieValue));
    return res;
  }
  const res = new NextResponse(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "private, max-age=60",
    },
  });
  if (setCookie && cookieValue) res.headers.append("Set-Cookie", sessionCookie(cookieValue));
  return res;
}
