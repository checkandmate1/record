import { NextRequest, NextResponse } from "next/server";

// `auth()` wraps the handler; unwrap it so the proxy function can be called directly. The real
// module is ESM (@auth/core) and would not parse under Jest anyway.
jest.mock("@/lib/auth", () => ({
  auth: (handler: unknown) => handler,
}));

type ProxyHandler = (req: NextRequest) => Promise<NextResponse> | NextResponse;

const BUCKET = "record-bucket";
const REGION = "us-east-1";

// `proxy.ts` reads AWS_S3_BUCKET / AWS_REGION at module scope, so pin them before loading it.
function loadProxy(): ProxyHandler {
  let handler: ProxyHandler | undefined;
  jest.isolateModules(() => {
    process.env.AWS_S3_BUCKET = BUCKET;
    process.env.AWS_REGION = REGION;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    handler = require("@/proxy").default as ProxyHandler;
  });
  return handler!;
}

function request(path: string, session: { role?: string } | null = { role: "WEB_MASTER" }) {
  const req = new NextRequest(`http://localhost:3000${path}`);
  (req as unknown as { auth: unknown }).auth = session ? { user: { id: "u1", ...session } } : null;
  return req;
}

function apiRequest(
  path: string,
  init: { method?: string; ip?: string; origin?: string; referer?: string } = {},
  session: { role?: string } | null = null,
) {
  const headers = new Headers();
  if (init.ip) headers.set("x-real-ip", init.ip);
  if (init.origin) headers.set("origin", init.origin);
  if (init.referer) headers.set("referer", init.referer);
  const req = new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers,
  });
  (req as unknown as { auth: unknown }).auth = session ? { user: { id: "u1", ...session } } : null;
  return req;
}

async function headersFor(path: string, session?: { role?: string } | null) {
  const res = await loadProxy()(request(path, session));
  return res.headers;
}

describe("proxy security headers", () => {
  it("sets a CSP and HSTS on a normal page response", async () => {
    const h = await headersFor("/");
    expect(h.get("Content-Security-Policy")).toBeTruthy();
    expect(h.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("sets them on the anonymous redirect to /login too", async () => {
    const res = await loadProxy()(request("/dashboard", null));
    expect(res.status).toBe(307);
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(res.headers.get("Strict-Transport-Security")).toBeTruthy();
  });

  it("sets them on the JSON 401 for anonymous API calls", async () => {
    const res = await loadProxy()(request("/api/search", null));
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("sets them on the 429 from the rate limiter", async () => {
    const proxy = loadProxy();
    let limited: NextResponse | undefined;

    // The anonymous bucket is 60/min, keyed on x-real-ip.
    for (let i = 0; i < 70; i++) {
      const res = await proxy(apiRequest("/api/search", { ip: "203.0.113.9" }));
      if (res.status === 429) {
        limited = res;
        break;
      }
    }

    expect(limited).toBeDefined();
    expect(await limited!.json()).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    });
    expect(limited!.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(limited!.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("sets them on the 403 from the cross-origin check", async () => {
    const res = await loadProxy()(
      apiRequest("/api/articles", { method: "POST", origin: "https://evil.example" }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Cross-origin request denied" },
    });
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("still lets a same-origin mutating request through the origin check", async () => {
    const res = await loadProxy()(
      apiRequest(
        "/api/articles",
        { method: "POST", origin: "http://localhost:3000" },
        { role: "WEB_MASTER" },
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-nonce")).toBeTruthy();
  });

  it("uses a fresh nonce per request and forwards it as x-nonce", async () => {
    const proxy = loadProxy();
    const first = await proxy(request("/"));
    const second = await proxy(request("/"));

    const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']+)'/)?.[1];
    const a = nonceOf(first.headers.get("Content-Security-Policy"));
    const b = nonceOf(second.headers.get("Content-Security-Policy"));

    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
    // Next reads the nonce off the forwarded request header while rendering.
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(a);
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(
      first.headers.get("Content-Security-Policy"),
    );
  });

  it("allows the S3 bucket and Google avatars for images, media and fetches", async () => {
    const csp = (await headersFor("/")).get("Content-Security-Policy")!;
    const bucketRegional = `https://${BUCKET}.s3.${REGION}.amazonaws.com`;

    expect(csp).toContain(`img-src 'self' data: blob:`);
    expect(csp).toContain("https://lh3.googleusercontent.com");
    expect(csp).toContain(bucketRegional);
    // The layout editor PUTs the file to a presigned URL on this origin.
    expect(csp.match(/connect-src [^;]+/)![0]).toContain(bucketRegional);
    expect(csp.match(/media-src [^;]+/)![0]).toContain(bucketRegional);
  });

  it("locks down framing, base, forms, objects and scripts", async () => {
    const csp = (await headersFor("/")).get("Content-Security-Policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("'strict-dynamic'");
    // Tailwind 4 / next-font emit inline styles; scripts never get unsafe-inline.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp.match(/script-src [^;]+/)![0]).not.toContain("unsafe-inline");
  });

  it("only allows 'unsafe-eval' outside production", async () => {
    const original = process.env.NODE_ENV;
    try {
      Object.defineProperty(process.env, "NODE_ENV", { value: "production", configurable: true });
      const prod = (await headersFor("/")).get("Content-Security-Policy")!;
      expect(prod).not.toContain("unsafe-eval");

      Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true });
      const dev = (await headersFor("/")).get("Content-Security-Policy")!;
      expect(dev).toContain("'unsafe-eval'");
    } finally {
      Object.defineProperty(process.env, "NODE_ENV", { value: original, configurable: true });
    }
  });
});

describe("proxy auth exemptions", () => {
  it("serves /robots.txt anonymously", async () => {
    const res = await loadProxy()(request("/robots.txt", null));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects anonymous page requests to /login with the callbackUrl", async () => {
    const res = await loadProxy()(request("/article/some-slug", null));
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/login?callbackUrl=%2Farticle%2Fsome-slug",
    );
  });

  it("still keeps non-dashboard roles out of /dashboard", async () => {
    const res = await loadProxy()(request("/dashboard", { role: "READER" }));
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("still keeps non-admins out of /admin", async () => {
    const res = await loadProxy()(request("/admin/users", { role: "EDITOR" }));
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });
});
