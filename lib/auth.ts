import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  pages: {
    error: "/auth-error",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Google verifies email ownership and we restrict to @horacemann.org + require email_verified
      // below, so linking a new Google sign-in to an existing (placeholder) User by email is safe —
      // it's what claims a directory-added author when that person finally logs in.
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      // Source of truth is the OAuth profile (always populated by Google). After Phase 5 the
      // legacy User.email column is NULL on disk; the Prisma extension synthesizes it from the
      // envelope ciphertext on read, but adapter-level lookups can land in the callback before
      // that synthesis applies, so we check the raw profile email too.
      const email = (profile as { email?: string } | null)?.email ?? user.email;
      if (!email?.endsWith("@horacemann.org")) {
        return false;
      }
      // Account-linking trusts the email to attach a Google login to an existing (placeholder)
      // row, so the email MUST be verified by Google — a domain suffix alone is not ownership.
      const emailVerified = (profile as { email_verified?: boolean } | null)?.email_verified;
      if (emailVerified === false) {
        return false;
      }
      // Persist the Google profile image so it survives custom uploads, and — if this row was a
      // directory-added placeholder — claim it: clear the flag and refresh name/photo from Google.
      // The adapter links this Google account to the existing row by email
      // (allowDangerousEmailAccountLinking), so every credit already pointing at it now applies.
      const googleImage = (profile as { picture?: string })?.picture ?? user.image;
      const googleName = (profile as { name?: string })?.name ?? user.name ?? undefined;
      if (user.id) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            ...(googleImage ? { googleImage } : {}),
            isPlaceholder: false,
            ...(googleName ? { name: googleName } : {}),
          },
        }).catch(() => {
          // User may not exist yet on first sign-in (adapter creates after); the next session
          // load reconciles. Placeholders already exist, so this update applies to them.
        });
      }
      return true;
    },
    async session({ session, user }) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          role: true,
          isAdmin: true,
          image: true,
          googleImage: true,
          // image is encrypted; without these the extension can't decrypt it and the
          // "seed googleImage from image" check below always sees a null image.
          encryptedDek: true,
          dekKekVersion: true,
          imageCiphertext: true,
        },
      });
      if (dbUser) {
        session.user.id = dbUser.id;
        session.user.role = dbUser.role;
        session.user.isAdmin = dbUser.role === "WEB_TEAM" || dbUser.role === "WEB_MASTER";
        // If googleImage not set yet, seed it from the current image
        if (!dbUser.googleImage && dbUser.image && !(dbUser.image as string).startsWith("data:")) {
          await prisma.user.update({
            where: { id: user.id },
            data: { googleImage: dbUser.image as string },
          });
        }
      }
      return session;
    },
  },
});
