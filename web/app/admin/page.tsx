import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import SiteHeader from "@/components/site-header";
import AdminDashboard from "@/components/admin/dashboard";

export const dynamic = "force-dynamic";

/** Admin-only. Non-admins (and signed-out visitors) go home. */
export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(await isAdminUser(session.user.id, session.user.email))) {
    redirect("/");
  }
  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <SiteHeader />
      <main className="flex-1">
        <AdminDashboard />
      </main>
    </div>
  );
}
