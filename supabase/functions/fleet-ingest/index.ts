import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Receiver for the delivery-car dashcams (Howen Hero-MC30-02).
// The dashcams speak a binary TCP protocol (JT/T 808 family), so a small gateway server
// decodes it and POSTs JSON here with the shared token in x-fleet-token:
//   { "device_id": "...", "positions": [{ at, lat, lng, speed, heading, ignition }],
//     "events": [{ at, kind, lat?, lng?, speed?, media_url?, media_kind?, details? }] }
// or an array of those. public.fleet_ingest() stores it and works out engine on/off and overspeed.
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

let secret: string | null = null;
let secretAt = 0;
async function token() {
  if (!secret || Date.now() - secretAt > 5 * 60_000) {
    const { data } = await db.rpc("get_app_secret", { p_key: "fleet_ingest_token" });
    secret = data ?? null;
    secretAt = Date.now();
  }
  return secret;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// constant-time compare so the token can't be guessed byte by byte
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const expected = await token();
  const given = req.headers.get("x-fleet-token") ?? "";
  if (!expected || !same(given, expected)) return json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const size = JSON.stringify(body).length;
  if (size > 2_000_000) return json({ error: "too large" }, 413);

  const { data, error } = await db.rpc("fleet_ingest", { p: body });
  if (error) {
    console.error("fleet_ingest", error.message);
    return json({ error: error.message }, 500);
  }
  return json({ ok: true, ...data });
});
