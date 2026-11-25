# Vuelos BCN ⇄ AGP

Rastreador de precios de **Vueling (VY)** y **Ryanair (FR)** entre Barcelona y Málaga, pensado para una pareja a distancia. Vigila los viajes que planeamos, guarda el histórico, detecta ofertas flash y avisa por Telegram. Nunca compra: solo enlaza a la web de la aerolínea.

> Estado: **fase 1** — proveedores, base de datos, escaneo diario de la ruta (solo guarda datos) y comprobación de un seguimiento de prueba.

## Arquitectura

```
pg_cron (Supabase, cada hora) ──POST──▶ /api/jobs/tick (Next.js en Vercel)
                                            │
                    ┌───────────────────────┼─────────────────────────┐
                    ▼                       ▼                         ▼
            Escaneo de la ruta      Seguimientos pendientes     Presupuesto SerpApi
            (9:00 y 21:00)          (según su frecuencia)       (api_usage por día)
                    │                       │
        ┌───────────┴──────────┐   ┌────────┴─────────────────────────┐
        ▼                      ▼   ▼                                  ▼
  Ryanair (gratis)     SerpApi calendario VY          SerpApi detalle (solo si hace falta)
  calendario + vuelos  (1 llamada por sentido)        número de vuelo, horas, price_insights
                    │
                    ▼
        Supabase Postgres (RLS por pareja)  ◀── Web Next.js (móvil, PWA)
```

### Decisiones importantes

1. **El presupuesto de SerpApi lo condiciona todo.** El plan gratuito tiene 250 búsquedas al mes. Por eso:
   - **Ryanair no gasta SerpApi**: usamos los endpoints públicos de ryanair.com (calendario de tarifas y disponibilidad), con caché en `provider_cache`, reintentos con espera exponencial y aislamiento de errores.
   - **Vueling se vigila por ruta, no por seguimiento**: el escaneo diario usa `google_flights_calendar` con `include_airlines=VY`, `stops=1` (directo) y `type=2` (solo ida). Una llamada por sentido da el mínimo de Vueling de cada día, y ese mismo dato lo usan todos los seguimientos. Tener 1 o 10 seguimientos cuesta lo mismo.
   - **Búsquedas de detalle** (`google_flights`) solo cuando la mejor combinación usa un precio de calendario de Vueling (sin hora ni número de vuelo) o el seguimiento tiene filtro horario. Tope diario configurable.
   - Cuenta: 2 escaneos/día × 2 sentidos ≈ 120/mes + detalle (tope 3/día) ≈ 90/mes → ~210 de 250. `src/lib/core/budget.ts` reparte lo que queda del mes entre los días restantes y baja el ritmo solo.
2. **Los procesos viven en Next.js, no en Edge Functions.** Todo el TypeScript (proveedores, cálculo, avisos) está en un solo sitio y se comparte con la web. pg_cron solo hace una llamada HTTP cada hora; el endpoint decide qué toca.
3. **Núcleo puro y testeable** en `src/lib/core/` (combinaciones, nuevo mínimo, frecuencia, presupuesto): sin red ni base de datos.
4. **Precios siempre por pasajero.** Los proveedores devuelven el precio de 1 adulto y se multiplica por los pasajeros. En low-cost suele coincidir; si quedan pocas plazas podría variar ligeramente.
5. **Nuevo mínimo con umbral acumulado**: se guarda el precio del último aviso (`notified_low`), de modo que varias bajadas de 1 € se acumulan hasta merecer un aviso.

### Estructura

```
src/lib/types.ts              Tipos comunes y la interfaz PriceProvider
src/lib/core/                 Lógica pura (con tests)
src/lib/providers/            Ryanair, SerpApi y fetch con reintentos
src/lib/server/               Cliente admin de Supabase, caché, contador de uso, registro de procesos
src/lib/jobs/                 scanRoute, checkTrackers y tick
src/app/api/jobs/tick         Endpoint que llama pg_cron cada hora
src/app/api/jobs/smoke        Prueba de humo de los proveedores desde Vercel
supabase/migrations/          Esquema de la base de datos (ya aplicado)
supabase/cron.sql             Programación de pg_cron
tests/                        Tests (Vitest) con respuestas simuladas
```

## Puesta en marcha

### 1. Claves que tienes que sacar tú

| Variable | Dónde se consigue |
|---|---|
| `SERPAPI_API_KEY` | Regístrate en serpapi.com (plan Free) → Dashboard → *Your Private API Key*. |
| `TELEGRAM_BOT_TOKEN` | En Telegram, abre **@BotFather** → `/newbot` → nombre (p. ej. *Vuelos BCN AGP*) → usuario acabado en `bot`. Te da el token. (Se usa en la fase 3.) |
| `SUPABASE_SECRET_KEY` | Supabase → proyecto **vuelos-bcn-agp** → *Project Settings* → *API Keys* → clave secreta (`sb_secret_…`). |
| `CRON_SECRET` | Cualquier cadena larga y aleatoria (40+ caracteres), p. ej. con `openssl rand -hex 32` o un generador de contraseñas. |
| `TELEGRAM_WEBHOOK_SECRET` | Otra cadena aleatoria (fase 3). |

Las públicas (`NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) ya están en `.env.example`.

**Nunca pegues las claves en un chat ni las subas a GitHub.** Solo van en las variables de entorno de Vercel (y en `.env.local` si desarrollas en tu ordenador, que está en `.gitignore`).

### 2. Desplegar en Vercel

1. vercel.com → *Add New…* → *Project* → importa el repositorio `vuelos-bcn-agp` de GitHub.
2. Antes de pulsar *Deploy*, abre *Environment Variables* y añade todas las de `.env.example` con sus valores.
3. *Deploy*.
4. Opcional (recomendado): *Settings* → *Functions* → *Function Region* → **Paris (cdg1)**, cerca de la base de datos.

### 3. Programar el proceso horario

1. En Supabase → *SQL Editor*, ejecuta (con tu valor real de `CRON_SECRET`):
   ```sql
   select vault.create_secret('TU_CRON_SECRET', 'cron_secret');
   ```
2. El resto de `supabase/cron.sql` (URL de la app y la programación) lo puede aplicar Claude con el conector de Supabase, o tú en el mismo editor.

### 4. Prueba de humo

```bash
curl -X POST https://TU-APP.vercel.app/api/jobs/smoke \
  -H "Authorization: Bearer TU_CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"serpapi": true}'
```

Comprueba que Ryanair responde desde Vercel y cuántos días devuelve el calendario de Google en una llamada (gasta 2 búsquedas de SerpApi). Si el calendario devuelve menos de 90 días, ajusta `SERPAPI_CALENDAR_MAX_DAYS`.

## Desarrollo

```bash
npm install
cp .env.example .env.local   # y rellena las claves
npm run dev
npm test                     # tests unitarios
npm run typecheck
```

## Fases

1. ✅ Proveedores, comprobación, base de datos, seguimiento de prueba y escaneo diario (solo guarda datos).
2. Web: listado de seguimientos, detalle y gráfica.
3. Avisos por Telegram (`new_low`, `target_price`).
4. Detector de ofertas flash, aviso `flash_sale` y pantalla "Ofertas".
5. Predicción (heurística) y aviso `rise_risk`.
6. PWA, ajustes y retoques finales.
