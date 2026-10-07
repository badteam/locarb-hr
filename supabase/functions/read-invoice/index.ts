import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Reads a supplier invoice photo with Claude and fills the invoice lines for review.
// Runs with the caller's own permissions (RLS); only the API key lives here.
const MODEL = Deno.env.get("INVOICE_MODEL") ?? "claude-sonnet-5-5";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TOOL = {
  name: "save_invoice",
  description: "Save the data read from the supplier invoice.",
  input_schema: {
    type: "object",
    properties: {
      supplier_name: { type: "string", description: "Seller / supplier name as printed (the company issuing the invoice, not the buyer)" },
      invoice_no: { type: "string" },
      invoice_date: { type: "string", description: "YYYY-MM-DD" },
      currency: { type: "string" },
      discount: { type: "number", description: "Invoice-level discount amount, 0 if none" },
      total: { type: "number", description: "Grand total payable as printed" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Item description exactly as printed (keep original language)" },
            qty: { type: "number" },
            unit: { type: "string", description: "Unit as printed: kg, pcs, ctn, box, pkt, bag..." },
            unit_price: { type: "number" },
            line_total: { type: "number" },
          },
          required: ["name", "qty", "unit_price"],
        },
      },
      unreadable: { type: "boolean", description: "true if the image is not an invoice or cannot be read" },
    },
    required: ["lines"],
  },
};

const PROMPT = `This is a supplier invoice received by a food business in Kuwait (prices are usually in KWD with 3 decimals).
Read every product line. Rules:
- Keep item names exactly as printed. Do not translate.
- qty is the delivered quantity; unit_price is the price per that unit after any line discount.
- If only a line total is shown, compute unit_price = line_total / qty.
- Skip subtotal, VAT, delivery and payment lines.
- Numbers: use "." for decimals; convert Arabic-Indic digits.
Call save_invoice once.`;

const b64 = (buf: ArrayBuffer) => {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\b(co|company|est|establishment|trading|general|w\.?l\.?l|llc|شركة|مؤسسة|للتجارة|العامة)\b/g, " ").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const body = await req.json().catch(() => ({}));
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: saved } = await admin.rpc("get_app_secret", { p_key: "anthropic_api_key" });
  const key = (saved as string | null) || Deno.env.get("ANTHROPIC_API_KEY");

  // settings page: check that the saved key works (owner only)
  if (body.test) {
    const { data: acc } = await db.rpc("my_access");
    if (!acc?.is_owner) return json({ error: "owner only" }, 403);
    if (!key) return json({ ok: false, error: "not_configured" });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 5, messages: [{ role: "user", content: "ok" }] }),
    });
    if (r.ok) return json({ ok: true });
    const t = await r.text();
    const reason = r.status === 401 ? "invalid_key" : /credit|balance|billing/i.test(t) ? "no_credit" : `error_${r.status}`;
    return json({ ok: false, error: reason, detail: t.slice(0, 200) });
  }

  const { invoice_id } = body;
  if (!invoice_id) return json({ error: "invoice_id required" }, 400);

  const { data: inv, error: invErr } = await db.from("purchase_invoices").select("*").eq("id", invoice_id).maybeSingle();
  if (invErr || !inv) return json({ error: "not found" }, 404);
  if (!["draft", "failed", "review"].includes(inv.status)) return json({ error: "invoice is not open" }, 409);
  if (!inv.image_paths?.length) return json({ error: "no image" }, 400);

  if (!key) {
    await db.from("purchase_invoices").update({ status: "draft", read_error: "not_configured" }).eq("id", invoice_id);
    return json({ error: "not_configured" }, 503);
  }

  await db.from("purchase_invoices").update({ status: "reading", read_error: null }).eq("id", invoice_id);
  const fail = async (msg: string, code = 500) => {
    await db.from("purchase_invoices").update({ status: "failed", read_error: msg.slice(0, 500) }).eq("id", invoice_id);
    return json({ error: msg }, code);
  };

  try {
    // images / pdf pages
    const content: unknown[] = [];
    for (const path of inv.image_paths) {
      const { data: file, error } = await db.storage.from("invoices").download(path);
      if (error || !file) return await fail("could not open photo");
      const type = file.type || (path.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      const data = b64(await file.arrayBuffer());
      content.push(type === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: ["image/png", "image/webp", "image/gif"].includes(type) ? type : "image/jpeg", data } });
    }
    content.push({ type: "text", text: PROMPT });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 8000, tools: [TOOL], tool_choice: { type: "tool", name: "save_invoice" },
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return await fail(res.status === 401 ? "invalid_key" : /credit|balance|billing/i.test(t) ? "no_credit" : `reader error ${res.status}: ${t.slice(0, 300)}`, 502);
    }
    const out = await res.json();
    const r = out.content?.find((c: any) => c.type === "tool_use")?.input;
    if (!r || r.unreadable || !Array.isArray(r.lines) || !r.lines.length) return await fail("unreadable", 422);

    // supplier: match by name against existing suppliers
    let supplier_id = inv.supplier_id;
    if (!supplier_id && r.supplier_name) {
      const { data: sups } = await db.from("suppliers").select("id,name").eq("active", true);
      const n = norm(r.supplier_name);
      const hit = (sups ?? []).find((s) => { const m = norm(s.name); return m && n && (m === n || n.includes(m) || m.includes(n)); });
      if (hit) supplier_id = hit.id;
    }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(r.invoice_date ?? "") ? r.invoice_date : null;

    await db.from("purchase_invoice_lines").delete().eq("invoice_id", invoice_id);
    const lines = r.lines.map((l: any, i: number) => {
      const qty = Number(l.qty) || 0;
      let price = Number(l.unit_price) || 0;
      const total = l.line_total != null ? Number(l.line_total) : null;
      if (!price && total && qty) price = total / qty;
      return { invoice_id, line_no: i + 1, raw_name: String(l.name ?? "").trim(), qty, unit_text: l.unit ?? null,
        unit_price: Math.round(price * 1000) / 1000, line_total: total };
    });
    const { error: lErr } = await db.from("purchase_invoice_lines").insert(lines);
    if (lErr) return await fail(lErr.message);

    await db.from("purchase_invoices").update({
      supplier_id, supplier_name_read: r.supplier_name ?? null,
      invoice_no: inv.invoice_no ?? r.invoice_no ?? null, invoice_date: inv.invoice_date ?? date,
      discount: Number(r.discount) || 0, total_read: r.total != null ? Number(r.total) : null,
      read_raw: r,
    }).eq("id", invoice_id);

    const { data: matched } = await db.rpc("auto_match_invoice", { p_invoice: invoice_id });
    await db.from("purchase_invoices").update({ status: "review" }).eq("id", invoice_id);
    return json({ ok: true, lines: lines.length, matched: matched ?? 0, supplier_found: !!supplier_id });
  } catch (e) {
    return await fail(String(e));
  }
});
