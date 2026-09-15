import { NextRequest, NextResponse } from "next/server";
import {
  appendGifSessionCookies,
  bindGifSession,
  clientIpFromHeaders,
  fetchTenorGif,
} from "@/server/gif-proxy";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = bindGifSession(request.headers.get("cookie"));
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const kind = request.nextUrl.searchParams.get("kind") === "preview" ? "preview" : "gif";
  const ip = clientIpFromHeaders(request.headers);
  const result = await fetchTenorGif(id, session.sid, kind, ip);
  if (result.status !== 200) {
    const res = NextResponse.json(result.body, { status: result.status });
    appendGifSessionCookies(res.headers, session);
    return res;
  }
  const res = new NextResponse(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "private, max-age=60",
    },
  });
  appendGifSessionCookies(res.headers, session);
  return res;
}
