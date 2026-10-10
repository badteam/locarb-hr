import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Reads an uploaded employee or branch document with Claude: type, number, holder, issue/expiry dates and the full text.
// Runs with the caller's own permissions (RLS). It never approves: the document stays "pending" for HR / the PRO to confirm.
// The API key is the same one the owner saved on the settings page.
const MODEL = Deno.env.get("DOCUMENT_MODEL") ?? "claude-sonnet-5-5";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const FIELDS = ["document_type", "document_number", "holder_name", "issue_date", "expiry_date", "branch"];
const TOOL = {
  name: "save_document",
  description: "Save what was read from the document.",
  input_schema: {
    type: "object",
    properties: {
      unreadable: { type: "boolean", description: "true if this is not a document or it cannot be read at all" },
      document_type: { type: "string", description: "Exactly one of the allowed type names given in the prompt, or 'OTHER: <short Arabic name>' if none fits" },
      document_number: { type: "string", description: "The main identifying number (civil ID no., licence no., passport no., policy no., contract no.)" },
      holder_name: { type: "string", description: "Person or company/branch the document is issued to, as printed" },
      issue_date: { type: "string", description: "Gregorian YYYY-MM-DD, empty if not printed" },
      expiry_date: { type: "string", description: "Gregorian YYYY-MM-DD, empty if not printed or not identifiable" },
      dates_found: {
        type: "array",
        items: { type: "object", properties: { label: { type: "string" }, date: { type: "string" }, calendar: { type: "string", enum: ["gregorian", "hijri"] } } },
        description: "Every date printed on the document with the label next to it",
      },
      expiry_confident: { type: "boolean", description: "true only if the expiry date is clearly labelled (e.g. 'تاريخ الانتهاء' / 'Expiry' / 'صالحة حتى') and fully legible" },
      holder_matches: { type: "boolean", description: "Whether the holder matches the expected owner given in the prompt (ignore spelling/transliteration differences)" },
      uncertain_fields: { type: "array", items: { type: "string", enum: FIELDS }, description: "Fields you are not sure about" },
      summary_ar: { type: "string", description: "One short Arabic sentence describing the document" },
      full_text: { type: "string", description: "All readable text on the document in its original language(s), line by line" },
    },
    required: ["unreadable", "expiry_confident", "uncertain_fields", "full_text"],
  },
};

const b64 = (buf: ArrayBuffer) => {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const okDate = (s?: string) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  return y >= 1980 && y <= 2100 && !isNaN(Date.parse(s)) ? s : null;
};
const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { kind, id } = await req.json().catch(() => ({}));
  if (!["employee", "branch"].includes(kind) || !id) return json({ error: "kind and id required" }, 400);

  const table = kind === "employee" ? "employee_documents" : "branch_documents";
  const bucket = kind === "employee" ? "employee-docs" : "branch-docs";
  const { data: doc } = await db.from(table).select("*").eq("id", id).maybeSingle();
  if (!doc) return json({ error: "not found" }, 404);
  if (doc.review_status === "approved") return json({ error: "already approved" }, 409);

  const paths: string[] = kind === "employee" ? [doc.front_image_path, doc.back_image_path].filter(Boolean) : doc.file_paths ?? [];
  const setDoc = (patch: Record<string, unknown>) => db.from(table).update(patch).eq("id", id);
  if (!paths.length) { await setDoc({ ai_status: "failed", ai_error: "no_file", review_status: "pending" }); return json({ error: "no_file" }, 400); }

  const { data: saved } = await admin.rpc("get_app_secret", { p_key: "anthropic_api_key" });
  const key = (saved as string | null) || Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) {
    await setDoc({ ai_status: "no_key", ai_error: null, review_status: "pending", review_fields: ["expiry_date"] });
    return json({ ok: false, error: "not_configured" });
  }

  // context: allowed types + expected owner
  const { data: types } = await db.from("document_types").select("id,name").eq("scope", kind).order("sort_order");
  let expected = "";
  if (kind === "employee") {
    const { data: e } = await db.from("employees").select("full_name").eq("id", doc.employee_id).maybeSingle();
    expected = `This document was uploaded for the employee "${e?.full_name ?? ""}" (names may be transliterated between Arabic and English).`;
  } else {
    const { data: b } = await db.from("branches").select("name").eq("id", doc.branch_id).maybeSingle();
    expected = `This document belongs to LoCarb (a healthy-food company in Kuwait), location/branch "${b?.name ?? ""}". The holder is usually the company name; set holder_matches=false only if it is clearly another company.`;
  }
  const chosen = types?.find((t) => t.id === doc.document_type_id)?.name;

  await setDoc({ ai_status: "reading", ai_error: null });
  try {
    const content: unknown[] = [];
    for (const p of paths) {
      const { data: file, error } = await db.storage.from(bucket).download(p);
      if (error || !file) throw new Error("could not open file");
      const type = file.type || (p.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
      const data = b64(await file.arrayBuffer());
      content.push(type === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
        : { type: "image", source: { type: "base64", media_type: ["image/png", "image/webp", "image/gif"].includes(type) ? type : "image/jpeg", data } });
    }
    content.push({
      type: "text",
      text: `This is an official document from Kuwait (Arabic and/or English). ${expected}
Allowed document types: ${(types ?? []).map((t) => `"${t.name}"`).join(", ")}.${chosen ? ` The uploader said it is "${chosen}".` : ""}
Rules:
- Dates must be Gregorian YYYY-MM-DD. Convert Arabic-Indic digits. Kuwaiti dates are usually DD/MM/YYYY.
- If only a Hijri date is printed, convert it and add the field to uncertain_fields.
- If several dates appear and you cannot tell which one is the expiry, leave expiry_date empty or put your best guess, set expiry_confident=false and add "expiry_date" to uncertain_fields.
- Never invent values; leave a field empty if it is not printed.
- If there are front and back images, combine them.
Call save_document once.`,
    });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 6000, tools: [TOOL], tool_choice: { type: "tool", name: "save_document" }, messages: [{ role: "user", content }] }),
    });
    if (!res.ok) {
      const t = await res.text();
      const reason = res.status === 401 ? "invalid_key" : /credit|balance|billing/i.test(t) ? "no_credit" : `reader error ${res.status}`;
      await setDoc({ ai_status: "failed", ai_error: reason, review_status: "pending" });
      return json({ ok: false, error: reason }, 502);
    }
    const out = await res.json();
    const r = out.content?.find((c: any) => c.type === "tool_use")?.input;
    if (!r || r.unreadable) {
      await setDoc({ ai_status: "failed", ai_error: "unreadable", review_status: "pending", ai_data: r ?? null, extracted_text: r?.full_text || null });
      return json({ ok: false, error: "unreadable" });
    }

    const flags = new Set<string>((r.uncertain_fields ?? []).filter((f: string) => FIELDS.includes(f)));
    // type
    let typeId = doc.document_type_id;
    const want = norm(String(r.document_type ?? "").replace(/^OTHER:\s*/i, ""));
    const hit = (types ?? []).find((t) => norm(t.name) === want) ?? (types ?? []).find((t) => want && (norm(t.name).includes(want) || want.includes(norm(t.name))));
    if (!typeId) { if (hit) typeId = hit.id; else flags.add("document_type"); }
    else if (hit && hit.id !== typeId) flags.add("document_type");
    // dates
    const expiry = okDate(r.expiry_date);
    const issue = okDate(r.issue_date);
    if (!expiry || !r.expiry_confident) flags.add("expiry_date");
    if (expiry && issue && issue > expiry) { flags.add("issue_date"); flags.add("expiry_date"); }
    if (r.holder_matches === false) flags.add(kind === "branch" ? "branch" : "holder_name");

    const patch: Record<string, unknown> = {
      document_type_id: typeId,
      document_number: doc.document_number || r.document_number || null,
      holder_name: r.holder_name || null,
      issue_date: issue ?? doc.issue_date,
      expiry_date: expiry ?? doc.expiry_date,
      extracted_text: [r.summary_ar, r.full_text].filter(Boolean).join("\n").slice(0, 20000),
      ai_data: { ...r, full_text: undefined, model: MODEL, read_at: new Date().toISOString() },
      ai_status: "done", ai_error: null,
      review_status: "pending",
      review_fields: [...flags],
    };
    const { error: upErr } = await setDoc(patch);
    if (upErr) throw new Error(upErr.message);
    return json({ ok: true, review_fields: [...flags], expiry_date: patch.expiry_date, summary: r.summary_ar ?? null });
  } catch (e) {
    await setDoc({ ai_status: "failed", ai_error: String(e).slice(0, 300), review_status: "pending" });
    return json({ ok: false, error: String(e) }, 500);
  }
});
