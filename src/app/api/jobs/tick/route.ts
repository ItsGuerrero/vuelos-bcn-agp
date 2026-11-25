import { createAdminClient, isAuthorizedCron } from "@/lib/server/admin";
import { tick } from "@/lib/jobs/tick";

export const maxDuration = 300;

/**
 * Lo llama pg_cron cada hora:
 *   POST /api/jobs/tick   Authorization: Bearer <CRON_SECRET>
 * Body opcional: { "forceScan": true, "trackers": false }
 */
export async function POST(req: Request) {
  if (!isAuthorizedCron(req)) return Response.json({ error: "No autorizado" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { forceScan?: boolean; trackers?: boolean };
  try {
    const result = await tick(createAdminClient(), { scan: body.forceScan, trackers: body.trackers });
    return Response.json(result);
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
