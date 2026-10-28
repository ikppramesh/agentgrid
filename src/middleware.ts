import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware:
 *  - CSRF defence for cookie-authenticated POSTs (login/logout/privacy): Origin must match host.
 *    (Server actions get Next.js' built-in origin check.)
 *  - Cheap redirect to /login for console pages without a session cookie (real auth happens server-side).
 *  - Request id for log correlation.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  const cookieAuthed = pathname.startsWith("/api/auth/") || pathname.startsWith("/api/privacy/");
  if (cookieAuthed && req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host !== req.headers.get("host")) {
      return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
    }
  }

  if (pathname.startsWith("/app") && !req.cookies.has("ag_session")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const res = NextResponse.next({ request: { headers: new Headers({ ...Object.fromEntries(req.headers), "x-request-id": requestId }) } });
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = { matcher: ["/app/:path*", "/api/:path*"] };
