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
    // First Google sign-in creates the user row; later ones refresh it.
    async signIn({ user, account }) {
      if (account?.provider === "google" && user.email) {
        const rows = (await getDb().query(
          `INSERT INTO users (email, name, image, provider, provider_account_id)
           VALUES ($1, $2, $3, 'google', $4)
           ON CONFLICT (email) DO UPDATE SET
             name = EXCLUDED.name,
             image = EXCLUDED.image,
             provider_account_id = EXCLUDED.provider_account_id
           RETURNING id`,
          [user.email.toLowerCase(), user.name ?? null, user.image ?? null, account.providerAccountId],
        )) as Array<{ id: string }>;
        user.id = rows[0].id;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
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
