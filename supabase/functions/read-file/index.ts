import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// General AI reader for any uploaded paper: government receipts, maintenance invoices, medical reports,
// civil ID cards, supplier licences, or "what is this?" (smart upload). It reads, matches the paper to
// employees / branches / suppliers / documents, and returns the result for the screen to fill in.
// It writes nothing, except the medical check on the employee's own request.
const MODEL = Deno.env.get("DOCUMENT_MODEL") ?? "claude-sonnet-5-5";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const BUCKETS = ["attachments", "branch-docs", "employee-docs", "invoices"];

const S = (description: string) => ({ type: "string", description });
const N = (description: string) => ({ type: "number", description });
const DATE = (d: string) => S(`${d}. Gregorian YYYY-MM-DD, empty if not printed`);
const COMMON = { summary_ar: S("One short Arabic sentence describing the paper"), full_text: S("All readable text, original language, line by line"),
  uncertain_fields: { type: "array", items: { type: "string" }, description: "Names of fields you are not sure about" } };

const PURPOSES: Record<string, { prompt: string; props: Record<string, unknown> }> = {
  transaction: {
    prompt: "This paper belongs to a government transaction handled by the company's PRO in Kuwait (residency, work permit, civil ID, municipality, commerce, fire department, food authority...). It may be a payment receipt, an application, an appointment, a letter, or the newly issued document itself.",
    props: {
      doc_kind: { type: "string", enum: ["receipt", "application", "appointment", "new_document", "letter", "other"] },
      title_ar: S("Short Arabic title for the transaction, e.g. 'تجديد إقامة' or 'تجديد رخصة البلدية'"),
      authority: S("Government body, in Arabic"), reference_no: S("Application / receipt / transaction number"),
      fees: N("Amount paid in KWD, 0 if none"), date: DATE("Date of the paper"), appointment_date: DATE("Appointment or deadline date if any"),
      person_name: S("Person named on the paper, if any"), civil_id: S("Civil ID number (12 digits) if printed"),
      licence_no: S("Licence / commercial registration number if printed"), branch_hint: S("Area or branch address printed, if any"),
      document_type: S("If doc_kind is new_document: what document it is, in Arabic"), document_number: S("If new_document: its number"),
      issue_date: DATE("If new_document: issue date"), expiry_date: DATE("If new_document: expiry date"),
    },
  },
  maintenance: {
    prompt: "This is an invoice or service report for maintenance work at a restaurant / central kitchen in Kuwait (AC, fire extinguishers, pest control, hoods, fridges, water tank...).",
    props: { vendor: S("Company or technician name"), date: DATE("Date the work was done or invoiced"), cost: N("Total amount in KWD"),
      work_done_ar: S("What was done, short Arabic"), next_visit: DATE("Next visit date if printed") },
  },
  medical: {
    prompt: "This should be a medical report / sick leave certificate (Kuwait, Arabic or English).",
    props: { is_medical: { type: "boolean" }, patient_name: S("Patient name as printed"), civil_id: S("Civil ID if printed"),
      issue_date: DATE("Report date"), sick_from: DATE("Sick leave start"), sick_to: DATE("Sick leave end (inclusive)"),
      days: N("Number of sick days"), facility: S("Clinic / hospital"), doctor: S("Doctor name") },
  },
  civil_id: {
    prompt: "This should be a Kuwaiti civil ID card (front and/or back) or a passport / residency.",
    props: { full_name_en: S("Name in English"), full_name_ar: S("Name in Arabic"), civil_id: S("12-digit civil ID number"),
      nationality: S("Nationality in Arabic"), birth_date: DATE("Birth date"), expiry_date: DATE("Card expiry date"),
      document_type: { type: "string", enum: ["البطاقة المدنية", "جواز السفر", "الإقامة", "other"] } },
  },
  supplier: {
    prompt: "This is a supplier's paper: commercial licence, contract, quotation or business card of a company that supplies a food business in Kuwait.",
    props: { doc_kind: { type: "string", enum: ["commercial_licence", "contract", "quotation", "business_card", "other"] },
      company_name: S("Company name as printed"), licence_no: S("Commercial licence number"), phone: S("Phone number"),
      contact_name: S("Contact person"), activity: S("Business activity"), licence_expiry: DATE("Licence expiry"),
      contract_expiry: DATE("Contract end date"), payment_terms: S("Payment terms if printed") },
  },
  classify: {
    prompt: "A manager of LoCarb (a healthy-food company in Kuwait with a central kitchen and branches) uploaded this paper without saying what it is. Decide what it is and read its key data.",
    props: {
      category: { type: "string", enum: ["employee_document", "branch_document", "supplier_invoice", "maintenance_invoice", "medical_report", "government_receipt", "supplier_document", "other"],
        description: "employee_document = civil ID, passport, residency, driving licence, health card of a person; branch_document = licence/permit/contract/insurance of a company location" },
      document_type: S("What it is, in Arabic (e.g. البطاقة المدنية, رخصة البلدية)"), document_number: S("Main number on it"),
      holder_name: S("Person or company it is issued to"), civil_id: S("Civil ID if printed"), licence_no: S("Licence number if printed"),
      issue_date: DATE("Issue date"), expiry_date: DATE("Expiry date"), expiry_confident: { type: "boolean" },
      supplier_name: S("For invoices: seller name"), total: N("For invoices/receipts: total amount KWD"), date: DATE("For invoices/receipts: date"),
      authority: S("For government receipts: government body"), area: S("Area / address printed, if any"),
    },
  },
};

const fromText = (content: any[]) => {
  const t = (content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
};
const sniff = (h: Uint8Array) => {
  const s = String.fromCharCode(...h);
  if (s.startsWith("%PDF")) return "application/pdf";
  if (h[0] === 0x89 && s.slice(1, 4) === "PNG") return "image/png";
  if (h[0] === 0xff && h[1] === 0xd8) return "image/jpeg";
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WEBP") return "image/webp";
  if (s.startsWith("GIF8")) return "image/gif";
  return null;
};
const b64 = (buf: ArrayBuffer) => {
  let s = ""; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const okDate = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && +s.slice(0, 4) > 1900 && +s.slice(0, 4) < 2100 ? s : null);
const norm = (s: string) => String(s || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
  .replace(/\b(co|company|est|trading|general|w\.?l\.?l|llc|kscc|شركه|مؤسسه|للتجاره|العامه|ذات|مسؤوليه|محدوده)\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const digits = (s: string) => String(s || "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");
// name similarity: share of words of the shorter name found in the other
const nameScore = (a: string, b: string) => {
  const x = norm(a).split(" ").filter((w) => w.length > 1), y = norm(b).split(" ").filter((w) => w.length > 1);
  if (!x.length || !y.length) return 0;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.filter((w) => l.includes(w)).length / s.length;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const debug = body.debug_token ? (await admin.rpc("check_debug_token", { t: body.debug_token })).data === true : false;
  const db = debug ? admin : createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });

  const { purpose, bucket, paths, target } = body;
  const P = PURPOSES[purpose];
  if (!P) return json({ ok: false, error: "unknown purpose" }, 400);
  if (!BUCKETS.includes(bucket) || !Array.isArray(paths) || !paths.length || paths.length > 6) return json({ ok: false, error: "bad files" }, 400);

  const { data: saved } = await admin.rpc("get_app_secret", { p_key: "anthropic_api_key" });
  const key = (saved as string | null) || Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ ok: false, error: "not_configured" });

  // medical check target: the caller must be able to see the request (RLS)
  let request: any = null, requestTable = "";
  if (purpose === "medical" && target?.id) {
    requestTable = target.kind === "correction" ? "punch_corrections" : "leave_requests";
    const { data } = await db.from(requestTable).select("*, employees:employee_id(full_name, civil_id)").eq("id", target.id).maybeSingle();
    if (!data) return json({ ok: false, error: "not found" }, 404);
    request = data;
  }

  try {
    const content: unknown[] = [];
    for (const p of paths) {
      const { data: file, error } = await db.storage.from(bucket).download(p);
      if (error || !file) return json({ ok: false, error: "could not open file" }, 403);
      const buf = await file.arrayBuffer();
      const type = sniff(new Uint8Array(buf.slice(0, 12)));
      if (!type) return json({ ok: false, error: "unsupported file type" });
      const data = b64(buf);
      content.push(type === "application/pdf" ? { type: "document", source: { type: "base64", media_type: type, data } }
        : { type: "image", source: { type: "base64", media_type: type, data } });
    }
    const today = new Date().toISOString().slice(0, 10);
    content.push({ type: "text", text: `${P.prompt}
Today is ${today}. Rules: dates as Gregorian YYYY-MM-DD (convert Arabic-Indic digits; Kuwaiti dates are usually DD/MM/YYYY; if only Hijri is printed convert it and list the field in uncertain_fields). Amounts in KWD with "." decimals. Never invent values: leave a field empty if it is not printed. If several pages/images are given, combine them.
Answer only by calling the save_reading tool once.` });

    const tool = { name: "save_reading", description: "Save what was read from the paper.", input_schema: { type: "object", properties: { ...P.props, ...COMMON }, required: ["summary_ar"] } };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 6000, tools: [tool], tool_choice: { type: "auto" }, messages: [{ role: "user", content }] }),
    });
    if (!res.ok) {
      const t = await res.text();
      let detail = t; try { detail = JSON.parse(t)?.error?.message ?? t; } catch { /* keep */ }
      return json({ ok: false, error: res.status === 401 ? "invalid_key" : /credit|balance|billing/i.test(t) ? "no_credit" : `reader error ${res.status}: ${detail}`.slice(0, 300) });
    }
    const out = await res.json();
    const r: any = out.content?.find((c: any) => c.type === "tool_use")?.input ?? fromText(out.content);
    if (!r) return json({ ok: false, error: "unreadable" });
    for (const k of Object.keys(r)) if (/date|expiry|_from|_to|appointment|next_visit/.test(k) && typeof r[k] === "string") r[k] = okDate(r[k]);

    // ---- matching against the company's own records (what the caller is allowed to see)
    const match: Record<string, unknown> = {};
    const cid = digits(r.civil_id);
    const person = r.person_name || r.patient_name || r.holder_name || r.full_name_ar || r.full_name_en;
    if (cid || person) {
      const { data: emps } = await db.from("employees").select("id, full_name, civil_id").eq("active", true);
      let emp = cid ? (emps ?? []).find((e: any) => digits(e.civil_id) === cid) : null;
      if (!emp && cid) {
        const { data: d } = await db.from("employee_documents").select("employee_id, document_number").eq("archived", false);
        const hit = (d ?? []).find((x: any) => digits(x.document_number) === cid);
        if (hit) emp = (emps ?? []).find((e: any) => e.id === hit.employee_id);
      }
      if (!emp && person) {
        const best = (emps ?? []).map((e: any) => [e, Math.max(nameScore(person, e.full_name), r.full_name_en ? nameScore(r.full_name_en, e.full_name) : 0)] as const).sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] >= 0.66) emp = best[0];
      }
      if (emp) match.employee = { id: emp.id, name: emp.full_name, by: cid && digits(emp.civil_id) === cid ? "civil_id" : "name" };
    }
    const nums = [r.document_number, r.licence_no, r.reference_no].map(digits).filter((x) => x.length >= 3);
    if (["transaction", "classify"].includes(purpose)) {
      const { data: bds } = await db.from("branch_documents_status").select("id, branch_id, branch_name, document_number, document_type_name").eq("archived", false);
      const hit = nums.length ? (bds ?? []).find((x: any) => x.document_number && nums.includes(digits(x.document_number))) : null;
      if (hit) { match.branch = { id: hit.branch_id, name: hit.branch_name }; match.branch_document = { id: hit.id, type: hit.document_type_name, number: hit.document_number }; }
      if (!match.branch && (r.branch_hint || r.area)) {
        const { data: brs } = await db.from("branches").select("id, name").eq("active", true);
        const b = (brs ?? []).find((x: any) => norm(r.branch_hint || r.area).includes(norm(x.name)));
        if (b) match.branch = { id: b.id, name: b.name };
      }
      if (match.employee && (r.document_type || r.doc_kind === "new_document")) {
        const { data: eds } = await db.from("employee_documents_status").select("id, document_type_name, document_number").eq("employee_id", (match.employee as any).id);
        const t = norm(r.document_type || "");
        const h = (eds ?? []).find((x: any) => (r.document_number && digits(x.document_number) === digits(r.document_number)) || (t && norm(x.document_type_name).includes(t)) || (t && t.includes(norm(x.document_type_name || "-"))));
        if (h) match.employee_document = { id: h.id, type: h.document_type_name, number: h.document_number };
      }
    }
    if (["supplier", "classify"].includes(purpose) && (r.company_name || r.supplier_name || r.holder_name)) {
      const { data: sups } = await db.from("suppliers").select("id, name");
      const n = r.company_name || r.supplier_name || r.holder_name;
      const best = (sups ?? []).map((s: any) => [s, nameScore(n, s.name)] as const).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 0.6) match.supplier = { id: best[0].id, name: best[0].name };
    }

    // ---- medical: compare with the request and save the check on it
    let check: any = null;
    if (request) {
      const reqFrom = request.start_date ?? request.work_date, reqTo = request.end_date ?? request.work_date;
      const warnings: string[] = [];
      if (r.is_medical === false) warnings.push("الورقة مو تقرير طبي");
      const empName = request.employees?.full_name ?? "";
      const nameOk = r.patient_name ? nameScore(r.patient_name, empName) >= 0.5 : null;
      const idOk = cid && request.employees?.civil_id ? digits(request.employees.civil_id) === cid : null;
      if (nameOk === false && idOk !== true) warnings.push(`الاسم في التقرير (${r.patient_name}) مو اسم الموظف`);
      if (r.sick_from && r.sick_to && (r.sick_from > reqFrom || r.sick_to < reqTo)) warnings.push(`التقرير يغطي من ${r.sick_from} إلى ${r.sick_to}، والطلب من ${reqFrom} إلى ${reqTo}`);
      if (!r.sick_from && r.issue_date && (r.issue_date < reqFrom || r.issue_date > reqTo)) warnings.push(`تاريخ التقرير ${r.issue_date} برا أيام الطلب`);
      if (!r.patient_name) warnings.push("ما قدر يقرا اسم المريض");
      check = { ok: warnings.length === 0, warnings, read: { patient_name: r.patient_name, sick_from: r.sick_from, sick_to: r.sick_to, days: r.days, facility: r.facility, issue_date: r.issue_date, summary_ar: r.summary_ar }, at: new Date().toISOString() };
      await admin.from(requestTable).update({ ai_check: check }).eq("id", request.id);
    }

    const { full_text, ...fields } = r;
    return json({ ok: true, purpose, data: fields, text: String(full_text ?? "").slice(0, 20000), match, check });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 300) }, 500);
  }
});
