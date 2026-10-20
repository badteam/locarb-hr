import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Matches item names typed by branch staff in an order sheet ("Plan tenderloin", "Rebay", "Smoke tarki", "Sabon")
// to the company's inventory items. It only suggests; the manager confirms every match on screen. Writes nothing.
const MODEL = Deno.env.get("DOCUMENT_MODEL") ?? "claude-sonnet-5-5";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const body = await req.json().catch(() => ({}));
  const lines: { name: string; unit?: string }[] = Array.isArray(body.lines) ? body.lines.slice(0, 400) : [];
  if (!lines.length) return json({ ok: false, error: "no lines" }, 400);

  const { data: items, error } = await db.from("inv_stock").select("id,name_ar,name_en,unit,category,unit_grams,unit_pieces").eq("active", true).order("category");
  if (error || !items?.length) return json({ ok: false, error: "not allowed" }, 403);

  const { data: saved } = await admin.rpc("get_app_secret", { p_key: "anthropic_api_key" });
  const key = (saved as string | null) || Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ ok: false, error: "not_configured" });

  const catalog = items.map((x: any, n: number) =>
    `${n + 1}|${x.name_ar}|${x.name_en ?? ""}|${x.unit ?? ""}${x.unit_grams ? ` ${x.unit_grams}g` : ""}${x.unit_pieces > 1 ? ` ${x.unit_pieces}pc` : ""}|${x.category ?? ""}`).join("\n");
  const asked = lines.map((l, i) => `${i + 1}. ${l.name}${l.unit ? ` [${l.unit}]` : ""}`).join("\n");

  const prompt = `LoCarb is a healthy-food restaurant chain in Kuwait. Branch staff (often Nepali/Indian, writing quickly) wrote what they took from the central kitchen in an Excel sheet. Their spelling is rough: "Rebay" = rib eye, "Tandarloin" = tenderloin, "Smoke tarki" = smoked turkey, "Kusa" = zucchini (كوسا), "Sabon" = soap (صابون), "Plan/Plain tenderloin" = plain (unmarinated) tenderloin, "K-net roll" = KNET card-machine paper roll, "Hallumi/Holloum" = halloumi, "Bolti" = tilapia fish, "Corriander leaves" = fresh coriander, "scrape" = trimmings/scraps.
Match each written line to ONE inventory item from the catalog (number|Arabic name|English name|stock unit & content|category).
Rules:
- Prefer the item a restaurant branch would actually receive from the kitchen (e.g. prepared/marinated kitchen products for "Crispy chicken", "Chicken fajita", "Chicken shawarma"; fresh produce for vegetables; the 130ml retail cup for "Ranch sauce 130ml" but the gallon for "Ranch sauce [gln]").
- The written unit is a hint: gln = gallon, pkt = packet, pc = piece, box = carton/box, bag, kg.
- confidence: high = clearly the same product; medium = probably, but several similar items exist or the name is vague; low = a guess. Use item 0 when nothing fits (do not force a match).
- note_ar: a few Arabic words only when confidence is not high (why, or which alternative).
Catalog:
${catalog}

Lines to match:
${asked}

Answer only by calling save_matches once, with one entry per line.`;

  const tool = {
    name: "save_matches", description: "Save the match for every line.",
    input_schema: { type: "object", required: ["matches"], properties: { matches: { type: "array", items: { type: "object", required: ["line", "item", "confidence"],
      properties: { line: { type: "number" }, item: { type: "number", description: "catalog number, 0 if none" },
        confidence: { type: "string", enum: ["high", "medium", "low"] }, note_ar: { type: "string" } } } } } },
  };
  // this model does not accept a forced tool_choice: the prompt asks for the tool call, and we retry once if it is missing
  let r: any = null, lastText = "";
  for (let attempt = 0; attempt < 2 && !r; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, tools: [tool], tool_choice: { type: "auto" }, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("match-order-items", res.status, t.slice(0, 500));
      return json({ ok: false, error: res.status === 401 ? "invalid_key" : /credit|balance|billing/i.test(t) ? "no_credit" : `reader error ${res.status}: ${t.slice(0, 200)}` });
    }
    const out = await res.json();
    r = out.content?.find((c: any) => c.type === "tool_use" && c.name === "save_matches")?.input ?? null;
    lastText = (out.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join(" ");
    if (!r?.matches) {
      // sometimes the answer comes as JSON text instead of a tool call
      const a = lastText.indexOf("{"), b = lastText.lastIndexOf("}");
      try { if (a >= 0 && b > a) r = JSON.parse(lastText.slice(a, b + 1)); } catch { r = null; }
      if (!r?.matches) r = null;
    }
  }
  if (!r) { console.error("match-order-items unreadable", lastText.slice(0, 300)); return json({ ok: false, error: "unreadable" }); }
  const matches = r.matches.map((m: any) => {
    const it: any = m.item > 0 ? items[m.item - 1] : null;
    return { line: Number(m.line) - 1, item_id: it?.id ?? null, confidence: it ? m.confidence : "none", note: m.note_ar ?? "" };
  }).filter((m: any) => m.line >= 0 && m.line < lines.length);
  return json({ ok: true, matches });
});
