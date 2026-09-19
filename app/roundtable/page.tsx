import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { isDashboardRole } from "@/lib/roles";
import { userMinimalNameSelect, userMinimalNameImageSelect } from "@/lib/prisma-selects";
import { SubpageHeader } from "@/app/subpage-header";
import { Footer } from "@/app/footer";
import { RoundTableDisplay } from "@/app/roundtable/round-table-display";
import { RoundTableSpinIntro } from "@/app/roundtable/round-table-spin-intro";
import { PastRoundTablesPanel } from "@/app/roundtable/past-roundtables-panel";

interface RoundTableData {
  id: string;
  slug: string;
  prompt: string;
  group: { publishedAt: Date | null } | null;
  sides: {
    id: string;
    label: string;
    order: number;
    authors: { user: { id: string; name: string; image: string | null } }[];
  }[];
  turns: { id: string; sideId: string; body: string; order: number }[];
}

export default async function RoundTableIndexPage() {
  const published = (await prisma.roundTable.findMany({
    where: { group: { status: "PUBLISHED" } },
    orderBy: [{ group: { publishedAt: "desc" } }, { updatedAt: "desc" }],
    include: {
      group: { select: { publishedAt: true } },
      sides: {
        orderBy: { order: "asc" },
        include: {
          authors: {
            include: { user: { select: userMinimalNameImageSelect } },
          },
        },
      },
      turns: { orderBy: { order: "asc" } },
    },
  })) as unknown as RoundTableData[];

  // The drawer's "Intro Animation" block is a QA control, not something readers
  // should see. Dashboard roles only.
  const showIntroControls = isDashboardRole((await auth())?.user?.role);

  const latest = published[0] ?? null;
  const archive = published.slice(1);

  const introAuthors = latest
    ? latest.sides.flatMap((s, sideIdx) =>
        s.authors.map((a) => ({
          id: a.user.id,
          name: a.user.name,
          image: a.user.image,
          sideIndex: sideIdx,
        })),
      )
    : [];

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      <SubpageHeader pageLabel="Round Table" badge="Round Table" />

      <main className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-8 pb-20 w-full flex-1">
        {latest ? (
          <>
            <RoundTableSpinIntro
              slug={latest.slug}
              authors={introAuthors}
              prompt={latest.prompt}
            />

            <div className="flex justify-end mb-6">
              <PastRoundTablesPanel
                items={archive}
                currentSlug={latest.slug}
                showIntroControls={showIntroControls}
              />
            </div>

            <RoundTableDisplay
              data={{ ...latest, publishedAt: latest.group?.publishedAt ?? null }}
            />
          </>
        ) : (
          <div className="text-center py-24">
            <p className="font-headline text-[11px] font-semibold tracking-[0.18em] uppercase text-maroon">
              The Round Table
            </p>
            <h1 className="mt-3 font-headline text-[28px] sm:text-[34px] font-bold tracking-wide">
              No round tables published yet.
            </h1>
            <p className="mt-3 font-headline text-[15px] text-caption">
              Check back next week.
            </p>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
