import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { errorResponse } from "@/lib/errors";
import { publishGroupById } from "@/lib/publish-group";

/**
 * POST /api/cron/publish-scheduled — the thing that actually makes `scheduleGroup` fire.
 *
 * Scheduling only ever wrote `ArticleGroup.scheduledAt`; nothing read it back, so a scheduled
 * issue stayed a draft forever. `/etc/cron.d/record-publish` (installed by
 * `deploy/provision.sh`) curls this every minute for each environment.
 *
 * Auth is a shared secret, NOT a session: `proxy.ts` exempts `/api/cron/` from the site-wide
 * login gate (the per-IP rate limit still applies). cron sends no Origin/Referer, which the
 * proxy's CSRF check allows.
 */

// The whole point is to read "now" on every request.
export const dynamic = "force-dynamic";

const BEARER = "Bearer ";

function isAuthorized(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith(BEARER)) return false;
  const provided = Buffer.from(header.slice(BEARER.length));
  const expected = Buffer.from(secret);
  // timingSafeEqual throws on a length mismatch, and the length of a secret is not itself
  // sensitive, so compare lengths first.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[cron/publish-scheduled] CRON_SECRET is not set — scheduled issues will never publish. " +
        "Add it to this environment's .env (openssl rand -hex 32) and restart pm2.",
    );
    return errorResponse(
      "CRON_NOT_CONFIGURED",
      "Scheduled publishing is not configured on this server",
      500,
    );
  }

  if (!isAuthorized(req, secret)) {
    return errorResponse("UNAUTHORIZED", "Invalid cron credentials", 401);
  }

  const due = await prisma.articleGroup.findMany({
    where: { status: "DRAFT", scheduledAt: { not: null, lte: new Date() } },
    select: { id: true },
    orderBy: { scheduledAt: "asc" },
  });

  const published: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  // Sequential on purpose: a handful of issues at most, and each publish invalidates the
  // homepage cache. One group failing its preconditions must not stop the others.
  for (const group of due) {
    try {
      await publishGroupById(group.id);
      published.push(group.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      console.error(`[cron/publish-scheduled] skipped ${group.id}: ${reason}`);
      skipped.push({ id: group.id, reason });
    }
  }

  return NextResponse.json({ published, skipped });
}
