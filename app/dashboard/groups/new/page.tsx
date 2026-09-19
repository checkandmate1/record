import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SubpageHeader } from "@/app/subpage-header";
import { createGroupWithArticles } from "@/app/dashboard/group-actions";
import { getSiteVolumeAndIssue } from "@/lib/site-volume";
import { isEditorRole } from "@/lib/roles";

export default async function NewGroupPage() {
  const session = await auth();
  if (!session?.user || !isEditorRole(session.user.role)) redirect("/dashboard");

  const { volumeNumber: currentVolume } = await getSiteVolumeAndIssue();
  const defaultVolume = currentVolume != null ? String(currentVolume) : "";

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      <SubpageHeader pageLabel="New Issue" />

      <div className="max-w-[900px] mx-auto px-4 sm:px-8 pt-8 pb-16">
        <h2 className="font-headline text-[28px] sm:text-[34px] font-bold tracking-wide">
          New Issue
        </h2>
        <p className="font-headline text-[13px] text-caption mt-1 tracking-wide">
          Volume defaults to the current site-wide value; override it if needed.
        </p>
        <div className="mt-4 h-[2px] bg-rule" />

        <form action={createGroupWithArticles} className="mt-8 space-y-6">
          <div className="flex gap-3">
            <div className="w-32">
              <label className="block font-headline text-[12px] font-semibold tracking-[0.06em] uppercase text-caption mb-1">
                Volume #
              </label>
              <input
                name="volumeNumber"
                type="number"
                min="1"
                step="1"
                defaultValue={defaultVolume}
                placeholder={defaultVolume || "—"}
                required
                className="w-full border border-ink/20 px-3 py-2 font-headline text-[16px] tracking-wide placeholder:text-caption/30 outline-none focus:border-ink transition-colors text-center"
              />
            </div>
            <div className="w-32">
              <label className="block font-headline text-[12px] font-semibold tracking-[0.06em] uppercase text-caption mb-1">
                Issue #
              </label>
              <input
                name="issueNumber"
                type="number"
                min="1"
                step="1"
                placeholder="#"
                required
                className="w-full border border-ink/20 px-3 py-2 font-headline text-[16px] tracking-wide placeholder:text-caption/30 outline-none focus:border-ink transition-colors text-center"
              />
            </div>
          </div>

          <button
            type="submit"
            className="cursor-pointer font-headline font-bold text-[14px] tracking-wide bg-ink text-white px-6 py-2.5 hover:bg-maroon transition-colors"
          >
            Create Issue
          </button>
        </form>
      </div>
    </div>
  );
}
