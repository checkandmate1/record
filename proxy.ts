import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { isDashboardRole, isEditorRole, isAdminRole } from "@/lib/roles";

const publicLimiter = rateLimit({ maxRequests: 60, windowMs: 60000 });
const authLimiter = rateLimit({ maxRequests: 120, windowMs: 60000 });

export default auth((req) => {
  const { pathname, search } = req.nextUrl;

  // Rate limiting for API routes
  if (pathname.startsWith("/api") && !pathname.startsWith("/api/auth")) {
    const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
    const limiter = req.auth?.user ? authLimiter : publicLimiter;
    if (!limiter.check(ip)) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }
  }

  // Origin/Referer check on state-changing /api/* methods. Defense-in-depth behind SameSite=Lax;
  // skip /api/auth/* (NextAuth has its own CSRF token flow).
  if (
    pathname.startsWith("/api") &&
    !pathname.startsWith("/api/auth") &&
    (req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE")
  ) {
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    const expected = req.nextUrl.origin;
    let originOk = false;
    if (origin) {
      originOk = origin === expected;
    } else if (referer) {
      try {
        originOk = new URL(referer).origin === expected;
      } catch {
        originOk = false;
      }
    }
    // Allow same-origin requests that send neither header (some non-browser clients).
    if (!originOk && (origin || referer)) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Cross-origin request denied" } },
        { status: 403 }
      );
    }
  }

  // Auth gate. /api/auth/* is exempt (NextAuth's own endpoints); /login and /auth-error are
  // exempt so anonymous visitors can reach the sign-in flow. Everything else requires a session.
  // API routes get a JSON 401; pages get a redirect to /login with callbackUrl preserved so
  // deep-links return to the intended URL after sign-in.
  const isAuthExempt =
    pathname.startsWith("/api/auth") ||
    pathname === "/login" ||
    pathname === "/auth-error";

  if (!isAuthExempt && !req.auth?.user) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(loginUrl);
  }

  const role = req.auth?.user?.role;

  // Dashboard routes require a dashboard role
  if (pathname.startsWith("/dashboard")) {
    if (!isDashboardRole(role)) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  // Group creation and settings require editor or above
  if (pathname.match(/^\/dashboard\/groups\/new/) || pathname.match(/^\/dashboard\/groups\/[^/]+\/settings/)) {
    if (!isEditorRole(role)) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  // Admin routes require web team
  if (pathname.startsWith("/admin")) {
    if (!isAdminRole(role)) {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf)).*)",
  ],
};
