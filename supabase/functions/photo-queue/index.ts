import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Server-side reader for the photo stock-take queue: photos waiting more than 2 minutes
// (the employee closed the page / phone locked) get read here. Called every minute by pg_cron.
const url = Deno.env.get("SUPABASE_URL")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const admin = createClient(url, service);
  const { data: secret } = await admin.rpc("get_app_secret", { p_key: "photo_queue_secret" });
  if (!secret || req.headers.get("x-queue-secret") !== secret) return new Response("forbidden", { status: 403 });

  // readings that got stuck half-way go back to the queue
  await admin.from("photo_items").update({ status: "new" }).eq("status", "reading").lt("created_at", new Date(Date.now() - 10 * 60e3).toISOString());

  const { data: items } = await admin.from("photo_items").select("id").eq("status", "new")
    .lt("created_at", new Date(Date.now() - 2 * 60e3).toISOString()).order("created_at").limit(4);
  const done: unknown[] = [];
  for (const it of items ?? []) {
    const r = await fetch(`${url}/functions/v1/read-product`, {
      method: "POST",
      headers: { Authorization: `Bearer ${service}`, apikey: service, "x-queue-secret": secret, "content-type": "application/json" },
      body: JSON.stringify({ item_id: it.id }),
    });
    done.push({ id: it.id, status: r.status, body: (await r.text()).slice(0, 200) });
    if (r.status === 503 || r.status === 502) break; // key missing / no credit: stop, try again next minute
  }
  return new Response(JSON.stringify({ processed: done }), { headers: { "content-type": "application/json" } });
});
