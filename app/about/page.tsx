import { prisma } from "@/lib/prisma";
import { SubpageHeader } from "@/app/subpage-header";
import { Footer } from "@/app/footer";
import Link from "next/link";
import { roleLabel } from "@/lib/roles";

type RowDef = {
  title: string;
  roles: string[];
};

const ROWS: RowDef[] = [
  { title: "Chief Editors", roles: ["CHIEF_EDITOR"] },
  { title: "Editors", roles: ["EDITOR"] },
  { title: "Staff Writers", roles: ["WRITER"] },
  { title: "Designers", roles: ["DESIGNER"] },
  { title: "Artists", roles: ["ART_TEAM"] },
  { title: "Photographers", roles: ["PHOTOGRAPHER"] },
  { title: "Web Team", roles: ["WEB_MASTER", "WEB_TEAM"] },
];

interface StaffUser {
  id: string;
  name: string;
  role: string;
  displayTitle: string | null;
  priority: number;
  image: string | null;
  googleImage: string | null;
}

export default async function AboutPage() {
  const allRoles = ROWS.flatMap((r) => r.roles);

  const users = (await prisma.user.findMany({
    where: { role: { in: allRoles as never } },
    select: {
      id: true,
      name: true,
      role: true,
      displayTitle: true,
      priority: true,
      image: true,
      googleImage: true,
      // envelope encryption metadata — needed by lib/prisma to decrypt name/image. Not PII.
      encryptedDek: true,
      dekKekVersion: true,
      nameCiphertext: true,
      imageCiphertext: true,
    },
  })) as unknown as StaffUser[];

  const grouped: Record<string, StaffUser[]> = {};
  for (const row of ROWS) {
    grouped[row.title] = users
      .filter((u) => row.roles.includes(u.role))
      .sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return (a.name ?? "").localeCompare(b.name ?? "");
      });
  }

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      <SubpageHeader pageLabel="About" />

      <main className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-10 pb-20 w-full">
        <h2 className="font-headline text-[32px] sm:text-[40px] font-bold leading-tight tracking-wide">
          About The Record
        </h2>
        <p className="font-headline text-[12px] sm:text-[13px] font-semibold tracking-[0.05em] text-caption mt-1">
          Horace Mann&rsquo;s Weekly Newspaper Since 1903
        </p>
        <div className="mt-4 h-[2px] bg-rule" />

        <section className="mt-12">
          <h3 className="font-headline text-[24px] sm:text-[28px] font-bold tracking-wide">
            Staff
          </h3>
          <div className="mt-2 h-px bg-rule" />

          <div className="mt-10">
            {ROWS.filter((row) => (grouped[row.title] ?? []).length > 0).map(
              (row, i) => {
                const members = grouped[row.title];
                return (
                  <div
                    key={row.title}
                    className={i > 0 ? "mt-14 pt-14 border-t border-ink" : ""}
                  >
                    <h4 className="font-headline text-[12px] font-semibold tracking-[0.14em] uppercase text-caption mb-6">
                      {row.title}
                    </h4>
                    <ul className="flex flex-wrap justify-center gap-x-8 gap-y-10">
                      {members.map((u) => (
                        <StaffCard key={u.id} user={u} />
                      ))}
                    </ul>
                  </div>
                );
              }
            )}
          </div>

          {users.length === 0 && (
            <p className="mt-8 font-headline text-[15px] text-caption italic">
              No staff members listed yet.
            </p>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}

function StaffCard({ user }: { user: StaffUser }) {
  const title = user.displayTitle ?? roleLabel(user.role);
  const avatar = user.image ?? user.googleImage;
  return (
    <li className="flex flex-col items-center text-center w-[140px]">
      <Link href={`/profile/${user.id}`} className="group block">
        <img
          src={avatar ?? undefined}
          alt={user.name}
          className="w-[112px] h-[112px] rounded-full object-cover bg-neutral-200 transition-transform duration-200 group-hover:scale-[1.03]"
        />
        <p className="mt-3 font-headline text-[15px] font-semibold leading-tight text-ink group-hover:text-maroon transition-colors">
          {user.name}
        </p>
      </Link>
      <p className="mt-1 font-headline text-[12px] italic text-caption leading-tight">
        {title}
      </p>
    </li>
  );
}
