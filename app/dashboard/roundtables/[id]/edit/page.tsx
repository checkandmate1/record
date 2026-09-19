import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { userMinimalNameSelect } from "@/lib/prisma-selects";
import { SubpageHeader } from "@/app/subpage-header";
import { RoundTableForm } from "@/app/dashboard/roundtable-form";
import { SavedToast } from "@/app/dashboard/saved-toast";
import { updateRoundTable, deleteRoundTable } from "@/app/dashboard/roundtable-actions";
import { isEditorRole } from "@/lib/roles";

export default async function EditRoundTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const { saved } = await searchParams;

  const rt = await prisma.roundTable.findUnique({
    where: { id },
    include: {
      sides: {
        orderBy: { order: "asc" },
        include: { authors: { include: { user: { select: userMinimalNameSelect } } } },
      },
      turns: { orderBy: { order: "asc" } },
      group: { select: { id: true, name: true, status: true } },
    },
  });

  if (!rt) notFound();

  const sideIndexById: Record<string, number> = {};
  rt.sides.forEach((s, i) => {
    sideIndexById[s.id] = i;
  });

  const initialSides = rt.sides.map((s) => ({
    id: s.id,
    label: s.label ?? "",
    authorIds: s.authors.map((a) => a.userId),
  }));

  const initialTurns = rt.turns.map((t) => ({
    sideIndex: sideIndexById[t.sideId] ?? 0,
    body: t.body ?? "",
  }));

  const staff = await prisma.user.findMany({
    where: { role: { not: "READER" } },
    select: userMinimalNameSelect,
    orderBy: { name: "asc" },
  });

  const canDelete = isEditorRole(session.user.role);

  const updateAction = async (formData: FormData) => {
    "use server";
    await updateRoundTable(id, formData);
  };

  const deleteAction = async () => {
    "use server";
    await deleteRoundTable(id);
  };

  const groupPublished = rt.group?.status === "PUBLISHED";

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      <SubpageHeader pageLabel="Round Table" />
      {saved && <SavedToast />}

      <div className="max-w-[900px] mx-auto px-4 sm:px-8 pt-8 pb-16 w-full">
        <Link
          href={`/dashboard/groups/${rt.groupId}`}
          className="font-headline text-[13px] tracking-wide text-caption hover:text-maroon transition-colors"
        >
          &larr; {rt.group?.name ?? "Group"}
        </Link>

        <div className="mt-3 flex items-baseline justify-between gap-4">
          <h2 className="font-headline text-[28px] sm:text-[34px] font-bold tracking-wide">
            Edit Round Table
          </h2>
          <p className="font-headline text-[12px] text-caption">
            Visibility follows the group
          </p>
        </div>
        <div className="mt-3 h-[2px] bg-rule" />

        <RoundTableForm
          action={updateAction}
          defaultPrompt={rt.prompt ?? ""}
          initialSides={initialSides}
          initialTurns={initialTurns}
          availableUsers={staff.map((u) => ({ id: u.id, name: u.name ?? "" }))}
        />

        <div className="mt-12 pt-8 border-t border-rule flex items-center justify-between gap-3">
          {groupPublished ? (
            <Link
              href={`/roundtable/${rt.slug}`}
              className="font-headline text-[13px] text-caption hover:text-maroon transition-colors"
            >
              View public page &rarr;
            </Link>
          ) : (
            <span className="font-headline text-[13px] text-caption italic">
              Will go live when the group is published.
            </span>
          )}
          {canDelete && (
            <form action={deleteAction}>
              <button
                type="submit"
                className="cursor-pointer font-headline text-[14px] tracking-wide text-maroon hover:underline"
              >
                Delete Round Table
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
