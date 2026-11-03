import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { businessOwner } from "@/lib/business";
import SiteHeader from "@/components/site-header";
import BusinessDashboard from "@/components/business/dashboard";

export const dynamic = "force-dynamic";

/** Business compliance dashboard: separate from chat. Deadline
 * tracking plus the document vault; more features are coming soon.
 * Only a current Business subscription (or a signed-out visitor gets
 * pointed at pricing) sees it. */
export default async function BusinessPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return (
      <div className="flex min-h-screen flex-col bg-ink">
        <SiteHeader />
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 text-center sm:px-6">
          <h1 className="font-display text-2xl text-stone-100">Compliance tracking for your business</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-400">
            Sign in with a Business plan to track renewals and keep company documents in one
            private vault. More features are coming soon.
          </p>
          <Link
            href="/pricing"
            className="mt-6 inline-block rounded-md bg-gold px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-gold-light"
          >
            See Business plans
          </Link>
        </main>
      </div>
    );
  }
  if (!(await businessOwner())) {
    return (
      <div className="flex min-h-screen flex-col bg-ink">
        <SiteHeader />
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 text-center sm:px-6">
          <h1 className="font-display text-2xl text-stone-100">Business is a separate plan</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-400">
            The compliance dashboard needs a current Business subscription. Upgrade to track
            renewals and keep company documents in one private vault. More features are coming
            soon.
          </p>
          <Link
            href="/pricing"
            className="mt-6 inline-block rounded-md bg-gold px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-gold-light"
          >
            Upgrade to Business
          </Link>
        </main>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <SiteHeader />
      <main className="flex-1">
        <BusinessDashboard />
      </main>
    </div>
  );
}
