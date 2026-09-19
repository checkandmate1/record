import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { userMinimalNameSelect } from "@/lib/prisma-selects";
import { AuthorsClient } from "@/app/admin/authors/authors-client";
import { isAdminRole } from "@/lib/roles";

// The admin layout already gates to WEB_TEAM+; this inline check is defense in depth (server
// actions re-check too).

export default async function AuthorsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!isAdminRole(session.user.role)) redirect("/");

  const rows = await prisma.user.findMany({
    where: { isPlaceholder: true },
    select: userMinimalNameSelect,
    orderBy: { createdAt: "asc" },
  });
  const initialAuthors = rows.map((u: (typeof rows)[number]) => ({
    id: u.id,
    name: u.name ?? "",
  }));

  return (
    <div>
      <h2 className="font-headline text-[28px] sm:text-[34px] font-bold tracking-wide">
        Authors
      </h2>
      <p className="font-headline text-[14px] text-caption mt-1 tracking-wide">
        Add people as authors before they&rsquo;ve logged in — from the HM directory or manually.
      </p>
      <div className="mt-4 h-[2px] bg-rule" />
      <AuthorsClient initialAuthors={initialAuthors} />
    </div>
  );
}
