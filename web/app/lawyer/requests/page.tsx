import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { verifiedLawyer } from "@/lib/business";
import SiteHeader from "@/components/site-header";
import LawyerRequests from "@/components/lawyer/requests";

export const dynamic = "force-dynamic";

/** Incoming business handoffs for verified lawyers only. */
export default async function LawyerRequestsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(await verifiedLawyer())) {
    redirect("/");
  }
  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <SiteHeader />
      <main className="flex-1">
        <LawyerRequests />
      </main>
    </div>
  );
}
