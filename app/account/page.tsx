import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { userPublicSelect } from "@/lib/prisma-selects";
import { SubpageHeader } from "@/app/subpage-header";
import { ProfilePicture } from "@/app/account/profile-picture";
import { roleLabel } from "@/lib/roles";

export default async function AccountPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { user } = session;

  // Fetch full user data including image. `image` is encrypted, so the select needs the
  // envelope columns (userPublicSelect) or it silently decrypts to null.
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { ...userPublicSelect, googleImage: true, createdAt: true },
  });

  const profileImage = (dbUser as { image?: string | null } | null)?.image ?? user.image ?? null;
  const googleImage = (dbUser as { googleImage?: string | null } | null)?.googleImage ?? null;
  const firstInitial = user.name?.charAt(0)?.toUpperCase() ?? "?";
  const joinDate = (dbUser?.createdAt ?? new Date()).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-screen flex flex-col bg-white font-body page-enter">
      <SubpageHeader pageLabel="Account" />

      <div className="max-w-[700px] mx-auto px-4 sm:px-8 pt-10 pb-16">
        {/* Page title */}
        <h2 className="font-headline text-[32px] sm:text-[38px] font-bold leading-tight tracking-wide">
          Account Settings
        </h2>
        <div className="mt-3 h-[2px] bg-rule" />

        {/* Profile card */}
        <div className="mt-10 flex items-start gap-6">
          <ProfilePicture
            userId={user.id}
            currentImage={profileImage}
            googleImage={googleImage}
            firstInitial={firstInitial}
          />

          <div className="min-w-0">
            <h3 className="font-headline text-[24px] font-bold leading-tight">
              {user.name}
            </h3>
            <p className="text-[15px] text-caption mt-1">{user.email}</p>
          </div>
        </div>

        {/* Details */}
        <div className="mt-10 divide-y divide-neutral-200">
          <DetailRow label="Role" value={roleLabel(user.role)} />
          <DetailRow label="Email" value={user.email ?? "\u2014"} />
          <DetailRow label="Member Since" value={joinDate} />
        </div>

        {/* Actions */}
        <div className="mt-12 pt-8 border-t border-rule">
          <h3 className="font-headline text-[18px] font-bold tracking-wide mb-4">
            Actions
          </h3>

          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="cursor-pointer font-headline text-[15px] tracking-wide text-maroon hover:underline transition-colors"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-4">
      <span className="font-headline text-[14px] font-semibold tracking-[0.08em] uppercase text-caption">
        {label}
      </span>
      <span className="font-headline text-[16px] tracking-wide">
        {value}
      </span>
    </div>
  );
}
