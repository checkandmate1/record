import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { isDashboardRole, isEditorRole, isAdminRole } from "@/lib/roles";

const publicLimiter = rateLimit({ maxRequests: 60, windowMs: 60000 });
const authLimiter = rateLimit({ maxRequests: 120, windowMs: 60000 });

// S3 origins the browser talks to directly: slot media and article images are served from the
// public `uploads/*` prefix, and the layout editor PUTs to a presigned URL. `lib/s3.ts` /
// `app/api/upload/route.ts` build virtual-hosted URLs (`<bucket>.s3.<region>.amazonaws.com`);
// the regionless form is listed too because older records may carry it.
const S3_ORIGINS = [
  process.env.AWS_S3_BUCKET ? `https://${process.env.AWS_S3_BUCKET}.s3.amazonaws.com` : "",
  process.env.AWS_S3_BUCKET && process.env.AWS_REGION
    ? `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`
    : "",
].filter(Boolean);

// Google profile photos (`User.googleImage`) are hot-linked from lh3.
const GOOGLE_AVATAR_ORIGIN = "https://lh3.googleusercontent.com";

const HSTS = "max-age=31536000; includeSubDomains";

// Nonce-based CSP. Next applies the nonce to its own framework/bundle/inline scripts when the
// request carries a `Content-Security-Policy` header containing `'nonce-…'` (it also needs the
// `x-nonce` request header) — so nothing in `app/` has to thread the nonce through, and there
// are no inline <script> tags of our own. `style-src` keeps `'unsafe-inline'` because Tailwind 4
// and next/font emit inline styles. `'unsafe-eval'` is dev-only: React uses eval to rebuild
// server stacks in the browser, and Turbopack HMR needs it.
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  const s3 = S3_ORIGINS.join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${s3 ? ` ${s3}` : ""} ${GOOGLE_AVATAR_ORIGIN}`,
    `media-src 'self' blob:${s3 ? ` ${s3}` : ""}`,
    "font-src 'self' data:",
    `connect-src 'self'${s3 ? ` ${s3}` : ""}${isDev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export default auth((req) => {
  const { pathname, search } = req.nextUrl;

  // A fresh nonce per request. A nonce only reaches a page that renders per request, so every
  // route must be dynamic: the site-wide auth gate makes all real pages dynamic, and
  // `app/not-found.tsx` calls `await connection()` because `/_not-found` would otherwise be
  // prerendered at build time with nonce-less scripts.
  //
  // KNOWN GAP: `/_global-error` is still prerendered (verified in `.next/prerender-manifest.json`
  // after a build — its HTML carries 10 script tags with no nonce). It is Next's built-in
  // last-resort page for a root-layout crash and must be a client component, so there is no
  // dynamic API to call in it. Consequence: in that one case the page renders but never
  // hydrates, so its "Try again" button is dead and the console logs CSP errors; a manual
  // reload still works. `/robots.txt` and `/favicon.ico` are also static but carry no scripts.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // Every response leaves through here — including the 429 / 403 / 401 / redirect short-circuits
  // below — so the security headers are set in one place.
  const secure = <T extends NextResponse>(res: T): T => {
    res.headers.set("Content-Security-Policy", csp);
    res.headers.set("Strict-Transport-Security", HSTS);
    return res;
  };

  // Rate limiting for API routes
  if (pathname.startsWith("/api") && !pathname.startsWith("/api/auth")) {
    const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
    const limiter = req.auth?.user ? authLimiter : publicLimiter;
    if (!limiter.check(ip)) {
      return secure(NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      ));
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
      return secure(NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Cross-origin request denied" } },
        { status: 403 }
      ));
    }
  }

  // Auth gate. /api/auth/* is exempt (NextAuth's own endpoints); /login and /auth-error are
  // exempt so anonymous visitors can reach the sign-in flow. Everything else requires a session.
  // API routes get a JSON 401; pages get a redirect to /login with callbackUrl preserved so
  // deep-links return to the intended URL after sign-in.
  // /robots.txt is exempt too: it is `disallow: /` (app/robots.ts) and crawlers never sign in,
  // so gating it meant crawlers saw the login page instead of the directive to stay out.
  const isAuthExempt =
    pathname.startsWith("/api/auth") ||
    pathname === "/login" ||
    pathname === "/auth-error" ||
    pathname === "/robots.txt";

  if (!isAuthExempt && !req.auth?.user) {
    if (pathname.startsWith("/api")) {
      return secure(NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
        { status: 401 }
      ));
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname + search);
    return secure(NextResponse.redirect(loginUrl));
  }

  const role = req.auth?.user?.role;

  // Dashboard routes require a dashboard role
  if (pathname.startsWith("/dashboard")) {
    if (!isDashboardRole(role)) {
      return secure(NextResponse.redirect(new URL("/", req.url)));
    }
  }

  // Group creation and settings require editor or above
  if (pathname.match(/^\/dashboard\/groups\/new/) || pathname.match(/^\/dashboard\/groups\/[^/]+\/settings/)) {
    if (!isEditorRole(role)) {
      return secure(NextResponse.redirect(new URL("/dashboard", req.url)));
    }
  }

  // Admin routes require web team
  if (pathname.startsWith("/admin")) {
    if (!isAdminRole(role)) {
      return secure(NextResponse.redirect(new URL("/", req.url)));
    }
  }

  // Forward the nonce *and* the CSP on the request so Next's renderer picks it up and stamps
  // `nonce="…"` onto every script tag it emits (see next/dist/docs → Content Security Policy).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  return secure(NextResponse.next({ request: { headers: requestHeaders } }));
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf)).*)",
  ],
};
