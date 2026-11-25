import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Cliente de Supabase con la sesión del usuario (respeta RLS). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // En Server Components no se pueden escribir cookies: el proxy ya refresca la sesión.
          }
        },
      },
    },
  );
}

export interface SessionContext {
  userId: string;
  email: string | null;
  coupleId: string | null;
  displayName: string | null;
}

/** Usuario actual + su pareja. null si no hay sesión. */
export async function getSession(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("couple_id, display_name")
    .eq("id", claims.sub)
    .maybeSingle();
  return {
    userId: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    coupleId: profile?.couple_id ?? null,
    displayName: profile?.display_name ?? null,
  };
}
