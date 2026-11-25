import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Destino de los enlaces de los emails de Supabase (confirmar cuenta o enlace de acceso).
 * Si el enlace se abre en otro navegador, el intercambio del código falla (PKCE),
 * pero la cuenta YA ha quedado confirmada: mandamos a /login para entrar con la contraseña.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabaseError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const supabase = await createClient();

  const dest = url.clone();
  dest.search = "";

  if (!supabaseError && (code || (tokenHash && type))) {
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type! });
    if (!error) {
      dest.pathname = "/";
      return NextResponse.redirect(dest);
    }
    dest.pathname = "/login";
    dest.searchParams.set("aviso", "confirmado");
    return NextResponse.redirect(dest);
  }

  dest.pathname = "/login";
  dest.searchParams.set("aviso", "enlace");
  return NextResponse.redirect(dest);
}
