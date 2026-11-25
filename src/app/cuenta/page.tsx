import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { getCouple, getCoupleProfiles, getRecentJobs, getSerpApiUsage } from "@/lib/data";
import { fechaHora } from "@/lib/format";
import { Page, Skeleton } from "@/components/ui";
import { UsageMeter } from "@/components/UsageMeter";
import { signOut } from "../actions";
import { ProfileForm } from "./ProfileForm";
import { PasswordForm } from "./PasswordForm";
import { TelegramCard } from "./TelegramCard";
import { createClient } from "@/lib/supabase/server";
import { getBotUsername } from "@/lib/notify/telegram";

export default function CuentaPage() {
  return (
    <Page title="Cuenta">
      <Suspense fallback={<Skeleton />}>
        <Account />
      </Suspense>
    </Page>
  );
}

const JOB_NAMES: Record<string, string> = { scan_route: "Escaneo de la ruta", check_trackers: "Comprobación de seguimientos" };
const STATUS: Record<string, string> = { ok: "✅", partial: "⚠️", error: "❌", running: "⏳" };

async function Account() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.coupleId) redirect("/pareja");
  const [profiles, couple, usage, jobs] = await Promise.all([getCoupleProfiles(), getCouple(), getSerpApiUsage(), getRecentJobs()]);
  const me = profiles.find((p) => p.id === s.userId);
  const partner = profiles.find((p) => p.id !== s.userId);
  const supabase = await createClient();
  const [{ data: own }, bot] = await Promise.all([
    supabase.from("profiles").select("telegram_link_code").eq("id", s.userId).single(),
    getBotUsername(),
  ]);
  const connectUrl = bot && own?.telegram_link_code ? `https://t.me/${bot}?start=${own.telegram_link_code}` : null;

  return (
    <div className="space-y-4">
      <TelegramCard
        linked={Boolean(me?.telegram_chat_id)}
        partnerLinked={partner ? Boolean(partner.telegram_chat_id) : null}
        partnerName={partner?.display_name ?? null}
        connectUrl={connectUrl}
      />
      <ProfileForm name={me?.display_name ?? ""} home={me?.home_airport ?? ""} />
      <PasswordForm />

      <section className="card space-y-2">
        <h2 className="font-semibold">Pareja</h2>
        {partner ? (
          <p className="text-sm">
            Compartes los viajes con <b>{partner.display_name ?? "tu pareja"}</b>.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">Tu pareja aún no se ha unido. Que entre en la web y escriba este código:</p>
            <p className="rounded-xl bg-background py-3 text-center font-mono text-2xl font-bold tracking-[0.3em]">
              {couple?.invite_code}
            </p>
          </>
        )}
      </section>

      <UsageMeter usage={usage} />

      <section className="card space-y-2">
        <h2 className="font-semibold">Últimos procesos automáticos</h2>
        <ul className="divide-y divide-border text-sm">
          {jobs.map((j) => (
            <li key={j.id} className="flex items-start gap-2 py-2">
              <span>{STATUS[j.status] ?? "•"}</span>
              <span className="flex-1">
                {JOB_NAMES[j.job] ?? j.job}
                {j.errors?.length > 0 && (
                  <span className="block text-xs text-muted" title={j.errors.map((e) => `${e.where}: ${e.message}`).join("\n")}>
                    {j.errors.length} {j.errors.length === 1 ? "aviso" : "avisos"}: {j.errors[0].where}
                  </span>
                )}
              </span>
              <span className="text-xs text-muted">{fechaHora(j.started_at)}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-center text-xs text-muted">{s.email}</p>
      <form action={signOut}>
        <button className="btn-ghost w-full text-rose-600">Cerrar sesión</button>
      </form>
    </div>
  );
}
