import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { Page, Skeleton } from "@/components/ui";
import { SetupForm } from "./SetupForm";

export default function ParejaPage() {
  return (
    <Page title="Bienvenido 👋">
      <Suspense fallback={<Skeleton lines={2} />}>
        <Setup />
      </Suspense>
    </Page>
  );
}

async function Setup() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.coupleId) redirect("/");
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Los seguimientos y ajustes se comparten entre los dos. Únete al espacio de tu pareja con su código.
      </p>
      <SetupForm defaultName={s.displayName ?? ""} />
    </div>
  );
}
