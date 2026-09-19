import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDateShort } from "@/lib/article-helpers";
import { ALL_ROLES, roleLabel } from "@/lib/roles";

const ROLE_FILTERS = ["ALL", ...ALL_ROLES] as const;
type RoleFilter = (typeof ROLE_FILTERS)[number];

const PER_PAGE = 25;

export default async function UsersListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; role?: string; q?: string }>;
}) {
  const { page: pageParam, role: roleParam, q: qParam } = await searchParams;
  const currentPage = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const roleFilter: RoleFilter = (ROLE_FILTERS as readonly string[]).includes(roleParam ?? "")
    ? (roleParam as RoleFilter)
    : "ALL";
  const query = (qParam ?? "").trim();

  const where: Record<string, unknown> = {};
  if (roleFilter !== "ALL") where.role = roleFilter;
  if (query) where.name = { contains: query, mode: "insensitive" };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        createdAt: true,
        // envelope encryption metadata — needed by lib/prisma extension to decrypt name/email/image.
        encryptedDek: true,
        dekKekVersion: true,
        emailCiphertext: true,
        nameCiphertext: true,
        imageCiphertext: true,
      },
    }),
    prisma.user.count({ where }),
  ]);
  const totalPages = Math.ceil(total / PER_PAGE);

  const buildUrl = (updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams();
    if (roleFilter !== "ALL") params.set("role", roleFilter);
    if (query) params.set("q", query);
    if (currentPage > 1) params.set("page", String(currentPage));
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "" || v === 0) params.delete(k);
      else params.set(k, String(v));
    }
    const qs = params.toString();
    return `/admin/users${qs ? `?${qs}` : ""}`;
  };

  return (
    <div>
      <h1 className="font-headline text-[30px] sm:text-[36px] font-bold tracking-wide">
        Users
      </h1>
      <p className="font-headline text-[14px] text-caption mt-1">
        {total} {total === 1 ? "user" : "users"}
      </p>
      <div className="mt-3 h-[2px] bg-rule" />

      {/* Filters */}
      <form method="get" className="mt-6 flex flex-wrap items-center gap-3">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search by name"
          className="border border-ink/20 px-3 py-2 font-body text-[14px] outline-none focus:border-ink w-full sm:w-[260px]"
        />
        <select
          name="role"
          defaultValue={roleFilter}
          className="border border-ink/20 px-3 py-2 font-body text-[14px] outline-none focus:border-ink"
        >
          {ROLE_FILTERS.map((r) => (
            <option key={r} value={r}>
              {r === "ALL" ? "All roles" : roleLabel(r)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="cursor-pointer font-headline text-[13px] tracking-wide border border-ink/20 px-4 py-2 hover:border-maroon hover:text-maroon transition-colors"
        >
          Filter
        </button>
        {(query || roleFilter !== "ALL") && (
          <Link
            href="/admin/users"
            className="font-headline text-[13px] text-caption hover:text-maroon"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Table */}
      <div className="mt-6 border border-ink/10">
        <div className="hidden sm:grid grid-cols-[auto_1fr_auto_auto] gap-4 px-4 py-3 bg-neutral-50 font-headline text-[12px] tracking-[0.08em] uppercase text-caption">
          <span className="w-8" />
          <span>Name</span>
          <span>Role</span>
          <span>Joined</span>
        </div>
        <ul className="divide-y divide-neutral-200">
          {users.length === 0 ? (
            <li className="px-4 py-10 text-center font-headline text-caption">
              No users match.
            </li>
          ) : (
            users.map((u: (typeof users)[number]) => (
              <li key={u.id}>
                <Link
                  href={`/admin/users/${u.id}`}
                  className="grid grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_auto_auto] gap-4 items-center px-4 py-3 hover:bg-neutral-50 transition-colors"
                >
                  {u.image ? (
                    <img
                      src={u.image}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover bg-neutral-200"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-maroon text-white flex items-center justify-center font-headline font-bold text-[13px]">
                      {(u.name ?? "?").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-headline font-bold text-[15px] truncate">{u.name}</p>
                    <p className="font-headline text-[12px] text-caption truncate">{u.email}</p>
                  </div>
                  <span className="font-headline text-[12px] tracking-[0.08em] uppercase text-caption">
                    {roleLabel(u.role)}
                  </span>
                  <span className="hidden sm:block font-headline text-[12px] text-caption">
                    {formatDateShort(u.createdAt)}
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2 font-headline text-[14px]">
          {currentPage > 1 && (
            <Link
              href={buildUrl({ page: currentPage - 1 === 1 ? null : currentPage - 1 })}
              className="px-3 py-2 border border-ink/20 hover:border-maroon hover:text-maroon"
            >
              &larr; Prev
            </Link>
          )}
          <span className="text-caption">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages && (
            <Link
              href={buildUrl({ page: currentPage + 1 })}
              className="px-3 py-2 border border-ink/20 hover:border-maroon hover:text-maroon"
            >
              Next &rarr;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
