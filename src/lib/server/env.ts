import "server-only";

/** Variables de entorno del servidor. Nunca se exponen al navegador. */
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export const serverEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  /** Opcional: sin clave, la app funciona solo con Ryanair. */
  get serpApiKey() {
    return process.env.SERPAPI_API_KEY || null;
  },
  get serpApiMonthlyLimit() {
    return Number(process.env.SERPAPI_MONTHLY_LIMIT ?? 250);
  },
  get serpApiCalendarMaxDays() {
    return Number(process.env.SERPAPI_CALENDAR_MAX_DAYS ?? 90);
  },
  get serpApiDetailCapPerDay() {
    return Number(process.env.SERPAPI_DETAIL_CAP_PER_DAY ?? 3);
  },
};

/** URL pública de la app (para los enlaces de los avisos y el webhook de Telegram). */
export const PRODUCTION_URL = "https://frombarcelonatomalaga.vercel.app";

export function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  return PRODUCTION_URL;
}
