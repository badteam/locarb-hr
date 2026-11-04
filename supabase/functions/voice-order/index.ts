import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Turns what a branch employee said (or typed) — "5 kilo chicken breast, 3 cartons milk..." — into order lines
// from the company's own items. It only suggests; the employee checks, swaps or removes each line on screen.
const MODEL = Deno.env.get("DOCUMENT_MODEL") ?? "claude-sonnet-5-5";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function logAi(db: any, status: number, errText: string | null, out: any) {
  try {
    await db.from("ai_calls").insert({ fn: "voice-order", ok: status < 300, status, error: errText ? String(errText).slice(0, 300) : null, model: out?.model ?? null,
      input_tokens: (out?.usage?.input_tokens ?? 0) + (out?.usage?.cache_read_input_tokens ?? 0) + (out?.usage?.cache_creation_input_tokens ?? 0) || null,
      output_tokens: out?.usage?.output_tokens ?? null });
  } catch { /* logging never blocks the work */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim().slice(0, 4000);
  if (!text) return json({ ok: false, error: "empty" }, 400);
  const favs: string[] = Array.isArray(body.fav_ids) ? body.fav_ids.slice(0, 400) : [];

  const { data: items, error } = await db.from("inv_stock").select("id,name_ar,name_en,unit,unit_grams,unit_pieces,category").eq("active", true).order("category").order("name_ar").limit(3000);
  if (error || !items?.length) return json({ ok: false, error: "not allowed" }, 403);

  const { data: saved } = await admin.rpc("get_app_secret", { p_key: "anthropic_api_key" });
  const key = (saved as string | null) || Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ ok: false, error: "not_configured" });

  const favSet = new Set(favs);
  // the item list is the same for every call: it is cached by the API, so each voice order costs much less after the first
  const catalog = items.map((x: any, n: number) =>
    `${n + 1}|${x.name_ar}|${x.name_en ?? ""}|${x.unit ?? ""}${x.unit_grams ? ` ${x.unit_grams}g` : ""}${x.unit_pieces > 1 ? ` ${x.unit_pieces}pc` : ""}|${x.category ?? ""}`).join("\n");
  const favNos = items.map((x: any, n: number) => (favSet.has(x.id) ? n + 1 : 0)).filter(Boolean).join(",");

  const tool = {
    name: "save_order", description: "Save the order lines.",
    input_schema: { type: "object", required: ["lines"], properties: {
      lines: { type: "array", items: { type: "object", required: ["said", "item", "qty"], properties: {
        said: { type: "string", description: "The words the employee used for this line" },
        item: { type: "number", description: "catalog number, 0 if nothing fits" },
        qty: { type: "number", description: "Quantity in the item's stock unit (convert: 2 cartons of an item stocked by carton = 2; '5 kilo' of an item stocked by kg = 5). If the spoken unit cannot be converted, give the spoken number" },
        unit_said: { type: "string", description: "Unit the employee said, if any (kilo, carton, piece, bag...)" },
        sure: { type: "boolean", description: "true only if it is clearly this item and the quantity is clear" },
        alternatives: { type: "array", items: { type: "number" }, description: "Up to 3 other catalog numbers of the same kind the employee might mean (other cuts, sizes, brands)" },
        note_ar: { type: "string", description: "A few Arabic words when not sure (why, or what to check)" },
      } } },
    } },
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 4000, tools: [tool], tool_choice: { type: "auto" },
      system: [{ type: "text", cache_control: { type: "ephemeral" }, text:
`LoCarb is a healthy-food restaurant chain in Kuwait. A branch employee (Arabic, English, Hindi or Nepali; often spoken quickly, speech-to-text may misspell) says what the branch needs from the central kitchen.
Turn it into order lines from the catalog (number|Arabic name|English name|stock unit & content|category).
Rules:
- One line per product the employee asked for, in the order said. Numbers may be words ("five", "خمسة", "पाँच").
- Prefer items a branch orders from the kitchen. When the employee says a general name ("chicken"), pick the most likely item and list the other kinds in alternatives, with sure=false.
- item = 0 if nothing in the catalog fits (still return the line so the employee can choose).
- Never invent quantities: if no number was said, qty = 1 and sure = false.
Catalog:
${catalog}` }],
      messages: [{ role: "user", content: `Items this branch usually orders (catalog numbers): ${favNos || "none"}\n\nThe employee said:\n${text}\n\nAnswer only by calling save_order once.` }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    await logAi(admin, res.status, t, null);
    return json({ ok: false, error: res.status === 401 ? "invalid_key" : /credit|balance|billing/i.test(t) ? "no_credit" : `reader error ${res.status}` });
  }
  const out = await res.json();
  await logAi(admin, res.status, null, out);
  let r: any = out.content?.find((c: any) => c.type === "tool_use")?.input ?? null;
  if (r && typeof r.lines === "string") { try { r.lines = JSON.parse(r.lines); } catch { r = null; } }
  if (!Array.isArray(r?.lines)) {
    const t = (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    try { r = a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : null; } catch { r = null; }
    if (!Array.isArray(r?.lines)) return json({ ok: false, error: "unreadable" });
  }
  const pick = (n: number) => (n > 0 && n <= items.length ? items[n - 1] : null);
  const lines = r.lines.map((l: any) => {
    const it: any = pick(Number(l.item));
    return { said: String(l.said ?? ""), item_id: it?.id ?? null, qty: Number(l.qty) > 0 ? Number(l.qty) : 1, unit_said: l.unit_said ?? null,
      sure: !!it && l.sure !== false, note: l.note_ar ?? "", alternatives: (l.alternatives ?? []).map((n: number) => pick(Number(n))?.id).filter((x: any) => x && x !== it?.id).slice(0, 3) };
  });
  return json({ ok: true, lines });
});
