import type { DefaultSession, NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { compare } from "bcryptjs";
import { getDb } from "./db";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        const email = creds?.email?.trim().toLowerCase();
        const password = creds?.password ?? "";
        if (!email || !password) return null;
        const rows = (await getDb().query(
          "SELECT id, email, name, password_hash FROM users WHERE email = $1",
          [email],
        )) as Array<{
          id: string;
          email: string;
          name: string | null;
          password_hash: string | null;
        }>;
        const row = rows[0];
        if (!row?.password_hash) return null;
        if (!(await compare(password, row.password_hash))) return null;
        return { id: row.id, email: row.email, name: row.name ?? undefined };
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  callbacks: {
    // First Google sign-in creates the user row (marked not onboarded, so
    // /post-login routes to the account-type and plan steps); later ones
    // just refresh it.
    async signIn({ user, account }) {
      if (account?.provider === "google" && user.email) {
        const email = user.email.toLowerCase();
        const existing = (await getDb().query("SELECT id FROM users WHERE email = $1", [
          email,
        ])) as Array<{ id: string }>;
        if (existing[0]) {
          await getDb().query(
            `UPDATE users SET name = $1, image = $2, provider_account_id = $3,
                              updated_at = now() WHERE id = $4`,
            [user.name ?? null, user.image ?? null, account.providerAccountId, existing[0].id],
          );
          user.id = existing[0].id;
        } else {
          const rows = (await getDb().query(
            `INSERT INTO users (email, name, image, provider, provider_account_id, onboarded)
             VALUES ($1, $2, $3, 'google', $4, FALSE)
             RETURNING id`,
            [email, user.name ?? null, user.image ?? null, account.providerAccountId],
          )) as Array<{ id: string }>;
          user.id = rows[0].id;
        }
      }
      return true;
    },
    async jwt({ token, user, trigger, session }) {
      if (user?.id) token.uid = user.id;
      // Name edits go through `useSession().update()`: fold the new name
      // into the token so the header reflects it without re-login.
      if (trigger === "update") {
        const name = (session as { name?: unknown } | null)?.name;
        if (typeof name === "string" && name.trim()) token.name = name.trim().slice(0, 60);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.uid === "string") {
        session.user.id = token.uid;
      }
      return session;
    },
  },
};
