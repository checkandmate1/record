import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { invalidateHomepage } from "@/lib/page-cache";

/**
 * Promote one issue to PUBLISHED — preconditions, write, and cache invalidation, with NO
 * session check.
 *
 * Two callers: `publishGroup` in `app/dashboard/group-actions.ts` (does `auth()` +
 * `requireEditor` first) and `POST /api/cron/publish-scheduled` (authenticates with
 * `CRON_SECRET` instead). It deliberately does NOT live in `group-actions.ts`: every export of
 * a `"use server"` module becomes a callable server-action endpoint, so an auth-free mutation
 * exported from there would be reachable by any signed-in user. Keep unauthenticated shared
 * logic in `lib/`.
 *
 * Throws (never returns a failure value) so the server action surfaces the message in the
 * dashboard; the cron route catches per group and reports it as `skipped`.
 */
export async function publishGroupById(id: string): Promise<void> {
  // An issue can't go public without a volume + issue number — those identify the edition
  // everywhere (homepage masthead, search-by-"Issue X Volume X", the issue PDF label).
  const group = await prisma.articleGroup.findUnique({
    where: { id },
    select: { volumeNumber: true, issueNumber: true },
  });
  if (!group) throw new Error("Issue not found");
  if (group.volumeNumber == null || group.issueNumber == null) {
    throw new Error("Set a volume number and issue number before publishing this issue.");
  }

  // Guarded on `status: "DRAFT"` so this is a compare-and-set, not a blind write: an editor
  // hitting Publish while a cron tick is in flight (or a slow tick overrunning the next one)
  // would otherwise rewrite `publishedAt` and move the issue's date. `updateMany` because
  // Prisma's `update` only accepts unique fields; `ArticleGroup` holds no encrypted columns, so
  // `updateMany` is safe here (see `lib/CLAUDE.md`).
  //
  // `scheduledAt` is cleared because the schedule has now been consumed; leaving it set means
  // a later unpublish drops the issue back to DRAFT with a past schedule, and the cron job
  // republishes it within the minute.
  const { count } = await prisma.articleGroup.updateMany({
    where: { id, status: "DRAFT" },
    data: { status: "PUBLISHED", publishedAt: new Date(), scheduledAt: null },
  });
  if (count === 0) throw new Error("Issue is already published");

  revalidatePath("/");
  invalidateHomepage();
  revalidatePath("/dashboard");
}
