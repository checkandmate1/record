import { notFound } from "next/navigation";
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
  group: { status: string; publishedAt: Date | null } | null;
  sides: {
    id: string;
    label: string;
    order: number;
    authors: { user: { id: string; name: string; image: string | null } }[];
  }[];
  turns: { id: string; sideId: string; body: string; order: number }[];
}

interface ArchiveItem {
  id: string;
  slug: string;
  prompt: string;
  group: { publishedAt: Date | null } | null;
  sides: {
    label: string;
    order: number;
    authors: { user: { id: string; name: string; image: string | null } }[];
  }[];
}

export default async function RoundTablePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [rt, archive] = await Promise.all([
    prisma.roundTable.findUnique({
      where: { slug },
      include: {
        group: { select: { status: true, publishedAt: true } },
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
    }) as unknown as Promise<RoundTableData | null>,
    prisma.roundTable.findMany({
      where: { group: { status: "PUBLISHED" }, slug: { not: slug } },
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
      },
    }) as unknown as Promise<ArchiveItem[]>,
  ]);

  if (!rt || rt.group?.status !== "PUBLISHED") notFound();

  // The drawer's "Intro Animation" block is a QA control, not something readers
  // should see. Dashboard roles only.
  const showIntroControls = isDashboardRole((await auth())?.user?.role);

  const introAuthors = rt.sides.flatMap((s, sideIdx) =>
    s.authors.map((a) => ({
      id: a.user.id,
      name: a.user.name,
      image: a.user.image,
      sideIndex: sideIdx,
    })),
  );

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      <SubpageHeader pageLabel="Round Table" badge="Round Table" />

      <main className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-8 pb-20 w-full flex-1">
        <RoundTableSpinIntro slug={rt.slug} authors={introAuthors} prompt={rt.prompt} />

        <div className="flex justify-end mb-6">
          <PastRoundTablesPanel
            items={archive}
            currentSlug={rt.slug}
            showIntroControls={showIntroControls}
          />
        </div>

        <RoundTableDisplay
          data={{ ...rt, publishedAt: rt.group.publishedAt }}
        />
      </main>
      <Footer />
    </div>
  );
}
