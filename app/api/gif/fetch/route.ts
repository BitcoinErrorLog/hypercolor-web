import { NextRequest, NextResponse } from "next/server";
import {
  appendGifSessionCookies,
  bindGifSession,
  clientIpFromHeaders,
  fetchTenorGif,
} from "@/server/gif-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = bindGifSession(request.headers.get("cookie"));
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const kind = request.nextUrl.searchParams.get("kind") === "preview" ? "preview" : "gif";
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const ip = clientIpFromHeaders(request.headers);
  const result = await fetchTenorGif(id, session.sid, kind, ip, token);
  if (result.status !== 200) {
    const res = NextResponse.json(result.body, { status: result.status });
    appendGifSessionCookies(res.headers, session);
    return res;
  }
  const body = Buffer.from(result.bytes);
  const res = new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
  appendGifSessionCookies(res.headers, session);
  return res;
}
