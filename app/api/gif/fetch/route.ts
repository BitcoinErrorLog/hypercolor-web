import { NextRequest, NextResponse } from "next/server";
import {
  fetchTenorGif,
  gifSessionIdFromCookie,
  newGifSessionId,
  sessionCookie,
} from "@/server/gif-proxy";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  let sid = gifSessionIdFromCookie(request.headers.get("cookie"));
  const setCookie = !sid;
  if (!sid) sid = newGifSessionId();
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const kind = request.nextUrl.searchParams.get("kind") === "preview" ? "preview" : "gif";
  const result = await fetchTenorGif(id, sid, kind);
  if (result.status !== 200) {
    const res = NextResponse.json(result.body, { status: result.status });
    if (setCookie) res.headers.append("Set-Cookie", sessionCookie(sid));
    return res;
  }
  const res = new NextResponse(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "private, max-age=60",
    },
  });
  if (setCookie) res.headers.append("Set-Cookie", sessionCookie(sid));
  return res;
}
