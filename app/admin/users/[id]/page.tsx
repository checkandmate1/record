import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDateShort } from "@/lib/article-helpers";
import { ALL_ROLES, roleLabel } from "@/lib/roles";
import {
  updateUserRole,
  updateUserDisplayTitle,
  updateUserPriority,
} from "@/app/admin/admin-actions";

export default async function EditUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const session = await auth();
  const isSelf = session?.user?.id === id;

  const [user, articleCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        displayTitle: true,
        priority: true,
        createdAt: true,
        // envelope encryption metadata — needed for decryption.
        encryptedDek: true,
        dekKekVersion: true,
        emailCiphertext: true,
        nameCiphertext: true,
        imageCiphertext: true,
      },
    }),
    prisma.article.count({ where: { credits: { some: { userId: id } } } }),
  ]);

  if (!user) notFound();

  const roleAction = updateUserRole.bind(null, id);
  const titleAction = updateUserDisplayTitle.bind(null, id);
  const priorityAction = updateUserPriority.bind(null, id);

  return (
    <div>
      <div className="flex items-center gap-3 font-headline text-[13px]">
        <Link href="/admin/users" className="text-caption hover:text-maroon">
          &larr; Users
        </Link>
      </div>

      {/* Identity */}
      <div className="mt-4 flex items-start gap-5">
        {user.image ? (
          <img
            src={user.image}
            alt={user.name ?? ""}
            className="w-20 h-20 rounded-full object-cover bg-neutral-200 shrink-0"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-maroon text-white flex items-center justify-center font-headline font-bold text-[30px] shrink-0">
            {(user.name ?? "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="font-headline text-[28px] sm:text-[34px] font-bold leading-tight">
            {user.name}
          </h1>
          <p className="font-headline text-[14px] text-caption mt-1">{user.email}</p>
          <p className="font-headline text-[12px] tracking-[0.08em] uppercase text-caption mt-2">
            {roleLabel(user.role)}
            {user.displayTitle && <> &middot; {user.displayTitle}</>}
          </p>
          <p className="font-headline text-[12px] text-caption mt-1">
            Joined {formatDateShort(user.createdAt)}
          </p>
          <div className="mt-2 font-headline text-[12px] text-caption">
            <Link
              href={`/profile/${user.id}`}
              className="text-maroon hover:underline"
            >
              View public profile &rarr;
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-6 h-[2px] bg-rule" />

      {saved && (
        <p className="mt-4 font-headline text-[13px] text-maroon">Saved.</p>
      )}

      {/* Stats */}
      <div className="mt-8 grid grid-cols-2 gap-4 max-w-md">
        <Stat label="Articles" value={articleCount} />
      </div>

      {/* Role */}
      <section className="mt-10">
        <h2 className="font-headline text-[20px] font-bold tracking-wide">Role</h2>
        <p className="font-headline text-[13px] text-caption mt-1">
          Controls what this user can do in the dashboard.
          {isSelf && <> You cannot change your own role.</>}
        </p>
        <div className="mt-3 h-px bg-rule" />

        <form action={roleAction} className="mt-5 flex flex-wrap items-center gap-3">
          <select
            name="role"
            defaultValue={user.role}
            disabled={isSelf}
            className="border border-ink/20 px-3 py-2 font-body text-[14px] outline-none focus:border-ink disabled:bg-neutral-100 disabled:text-caption"
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isSelf}
            className="cursor-pointer font-headline text-[14px] tracking-wide font-bold border border-ink/20 px-5 py-2 hover:border-maroon hover:text-maroon transition-colors disabled:cursor-not-allowed disabled:text-caption disabled:hover:border-ink/20 disabled:hover:text-caption"
          >
            Save Role
          </button>
        </form>
      </section>

      {/* Display title */}
      <section className="mt-12">
        <h2 className="font-headline text-[20px] font-bold tracking-wide">
          Display Title
        </h2>
        <p className="font-headline text-[13px] text-caption mt-1">
          Overrides the role label on bylines (e.g., &ldquo;Editor-in-Chief&rdquo;). Leave blank to use the default from role.
        </p>
        <div className="mt-3 h-px bg-rule" />

        <form action={titleAction} className="mt-5 flex flex-wrap items-center gap-3">
          <input
            name="displayTitle"
            defaultValue={user.displayTitle ?? ""}
            placeholder={roleLabel(user.role)}
            maxLength={80}
            className="border border-ink/20 px-3 py-2 font-body text-[14px] outline-none focus:border-ink w-full sm:w-[320px]"
          />
          <button
            type="submit"
            className="cursor-pointer font-headline text-[14px] tracking-wide font-bold border border-ink/20 px-5 py-2 hover:border-maroon hover:text-maroon transition-colors"
          >
            Save Title
          </button>
        </form>
      </section>

      {/* Priority */}
      <section className="mt-12">
        <h2 className="font-headline text-[20px] font-bold tracking-wide">
          Priority
        </h2>
        <p className="font-headline text-[13px] text-caption mt-1">
          Controls staff order on the About page. Higher numbers appear first within each row; ties are broken alphabetically.
        </p>
        <div className="mt-3 h-px bg-rule" />

        <form action={priorityAction} className="mt-5 flex flex-wrap items-center gap-3">
          <input
            name="priority"
            type="number"
            step="1"
            defaultValue={user.priority ?? 0}
            className="border border-ink/20 px-3 py-2 font-body text-[14px] outline-none focus:border-ink w-full sm:w-[160px]"
          />
          <button
            type="submit"
            className="cursor-pointer font-headline text-[14px] tracking-wide font-bold border border-ink/20 px-5 py-2 hover:border-maroon hover:text-maroon transition-colors"
          >
            Save Priority
          </button>
        </form>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-ink/10 px-4 py-3">
      <p className="font-headline text-[11px] tracking-[0.1em] uppercase text-caption">
        {label}
      </p>
      <p className="font-masthead text-[28px] leading-none mt-1">{value}</p>
    </div>
  );
}
