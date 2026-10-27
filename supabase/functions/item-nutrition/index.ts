import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// every AI call is written down so the owner sees spend and a finished balance on the home page
async function logAi(db: any, fn: string, status: number, errText: string | null, out: any) {
  try {
    await db.from("ai_calls").insert({ fn, ok: status < 300, status, error: errText ? String(errText).slice(0, 300) : null, model: out?.model ?? null,
      input_tokens: out?.usage?.input_tokens ?? null, output_tokens: out?.usage?.output_tokens ?? null });
  } catch { /* logging never blocks the work */ }
}


// Fills calories / macros for one inventory item:
//  mode "label":    reads the nutrition label photo (saved one, or new photos just uploaded)
//  mode "estimate": typical values for that kind of food, clearly marked as an estimate
// Only inventory managers / the owner can call it; the API key is the one saved in Settings.
const MODEL = Deno.env.get("PRODUCT_MODEL") ?? Deno.env.get("INVOICE_MODEL") ?? "claude-sonnet-5-5";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const ALLERGENS = ["gluten", "dairy", "egg", "tree_nuts", "peanut", "sesame", "soy", "fish", "shellfish", "mustard", "celery"];

const TOOL = {
  name: "save_nutrition",
  description: "Save the nutrition values per 100 g (or 100 ml). Always call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "false if the values cannot be read (label mode) or the item is not food (estimate mode)" },
      kcal: { type: "number" }, protein: { type: "number" }, carbs: { type: "number" }, fat: { type: "number" },
      ingredients: { type: "string", description: "Ingredients as printed (label mode only)" },
      allergens: { type: "array", items: { type: "string", enum: ALLERGENS } },
      note: { type: "string", description: "Short note IN ARABIC: what was uncertain, converted from per serving, or what reference food the estimate is based on" },
    },
    required: ["found"],
  },
};

const b64 = (buf: ArrayBuffer) => {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const sniff = (h: Uint8Array) => (h[0] === 0x89 ? "image/png" : h[0] === 0x52 && h[8] === 0x57 ? "image/webp" : "image/jpeg");
const num = (v: unknown) => (typeof v === "number" && isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: acc } = await db.rpc("my_access");
  if (!acc?.is_owner && !(acc?.permissions ?? []).includes("manage_inventory")) return json({ error: "not allowed" }, 403);

  const body = await req.json().catch(() => ({}));
  const { item_id, mode = "label", paths } = body;
  if (!item_id) return json({ error: "item_id required" }, 400);
  const { data: item } = await admin.from("inv_items").select("id,name_ar,name_en,brand,nutrition_label_path,image_path,ingredients_text,inv_categories(name)").eq("id", item_id).maybeSingle();
  if (!item) return json({ error: "not found" }, 404);

  const { data: saved } = await admin.rpc("get_app_secret", { p_key: "anthropic_api_key" });
  const key = (saved as string | null) || Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "not_configured" }, 503);

  const content: unknown[] = [];
  const desc = `Item: "${item.name_ar}"${item.name_en ? ` / "${item.name_en}"` : ""}${item.brand ? `, brand ${item.brand}` : ""}${(item as any).inv_categories?.name ? `, category ${(item as any).inv_categories.name}` : ""}.`;
  let labelPaths: string[] = [];
  if (mode === "label") {
    labelPaths = Array.isArray(paths) && paths.length ? paths.slice(0, 4) : [item.nutrition_label_path, item.image_path].filter(Boolean) as string[];
    if (!labelPaths.length) return json({ error: "no_photo" }, 400);
    for (const p of labelPaths) {
      const { data: file } = await admin.storage.from("product-photos").download(p);
      if (!file) continue;
      const buf = await file.arrayBuffer();
      content.push({ type: "image", source: { type: "base64", media_type: sniff(new Uint8Array(buf.slice(0, 12))), data: b64(buf) } });
    }
    if (!content.length) return json({ error: "no_photo" }, 400);
    content.push({ type: "text", text: `${desc}\nRead the nutrition facts table from these product photos. Give values per 100 g (or 100 ml); if only per serving is shown, convert with the serving size. If only kJ is shown, kcal = kJ / 4.184. Never invent numbers you cannot see: if there is no readable nutrition table, set found=false. Respond only by calling save_nutrition once.` });
  } else {
    content.push({ type: "text", text: `${desc}\nThis is a raw material in the inventory of a healthy-meal kitchen in Kuwait. Give typical nutrition values per 100 g (as purchased, raw/uncooked unless the name says otherwise), based on standard food composition data (e.g. USDA). For branded products, use typical values for that product type. If it is not a food (packaging, cleaning, disposables), set found=false. In note, say in Arabic which reference food you used. Respond only by calling save_nutrition once.` });
  }

  let r: any = null;
  for (let attempt = 0; attempt < 2 && !r; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, tools: [TOOL], tool_choice: { type: "auto" }, messages: [{ role: "user", content }] }),
    });
    if (!res.ok) {
      const t = await res.text();
      await logAi(admin, "item-nutrition", res.status, t, null);
      return json({ error: res.status === 401 ? "invalid_key" : /credit|balance|billing/i.test(t) ? "no_credit" : `reader error ${res.status}` }, 502);
    }
    const out = await res.json();
    await logAi(admin, "item-nutrition", res.status, null, out);
    r = out.content?.find((c: any) => c.type === "tool_use")?.input ?? null;
  }
  if (!r || !r.found || num(r.kcal) == null) return json({ ok: false, error: mode === "label" ? "no_table" : "not_food", note: r?.note ?? null });

  const patch: Record<string, unknown> = {
    kcal_100: num(r.kcal), protein_100: num(r.protein), carbs_100: num(r.carbs), fat_100: num(r.fat),
    nutrition_source: mode === "label" ? "ملصق المنتج" : "تقدير عام" + (r.note ? `: ${String(r.note).slice(0, 120)}` : ""),
    nutrition_updated_at: new Date().toISOString(),
  };
  if (mode === "label") {
    if (Array.isArray(paths) && paths.length) patch.nutrition_label_path = paths[0];
    if (r.ingredients) patch.ingredients_text = String(r.ingredients).slice(0, 2000);
    if (Array.isArray(r.allergens)) patch.allergens = r.allergens.filter((a: string) => ALLERGENS.includes(a));
  }
  const { error } = await admin.from("inv_items").update(patch).eq("id", item_id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, ...patch, note: r.note ?? null });
});
