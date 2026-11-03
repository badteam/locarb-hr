import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// سند (system monitor). Checks every active monitor target and stores the results with public.monitor_record().
// Called every 5 minutes by pg_cron with the monitor_run_token in x-monitor-token.
// When a system goes down or comes back, it emails monitor_settings.alert_emails through Resend
// (key in private.app_secrets 'resend_api_key'; without it only the portal bell is used).
// Body {"test_email": true} sends a test email instead of running the checks.
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function check(t: any) {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(t.url, { headers: { "User-Agent": "LoCarb-Sanad/1.0", ...(t.headers || {}) }, signal: ctl.signal, redirect: "follow" });
    await res.body?.cancel();
    const ms = Date.now() - started;
    const okStatus = (t.expect_status || [200]).includes(res.status);
    let error: string | null = null;
    if (!okStatus) error = `رد غير متوقع (${res.status})`;
    else if (ms > t.slow_ms) error = `بطيء جداً (${(ms / 1000).toFixed(1)} ثانية)`;
    return { id: t.id, ok: okStatus && ms <= t.slow_ms, status: res.status, ms, error };
  } catch (e) {
    const ms = Date.now() - started;
    const msg = (e as Error).name === "AbortError" ? "ما رد خلال 15 ثانية" : `ما قدرت أوصل له: ${(e as Error).message}`.slice(0, 200);
    return { id: t.id, ok: false, status: null, ms, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmail(to: string[], subject: string, rows: any[]) {
  const { data: key } = await db.rpc("get_app_secret", { p_key: "resend_api_key" });
  if (!key || !to?.length) return { sent: false, reason: key ? "no recipients" : "no resend key" };
  const list = rows.map((c) => c.kind === "down"
    ? `<li style="margin:8px 0"><b style="color:#B91C1C">عطل:</b> ${esc(c.name)}<br><span style="color:#555">${esc(c.error || "ما يرد")}</span><br><a href="${esc(c.url)}">${esc(c.url)}</a></li>`
    : c.kind === "up"
    ? `<li style="margin:8px 0"><b style="color:#1F8A4C">رجع يشتغل:</b> ${esc(c.name)}<br><span style="color:#555">توقف ${esc(c.minutes)} دقيقة</span></li>`
    : `<li style="margin:8px 0">${esc(c.text)}</li>`).join("");
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.7"><h2 style="margin:0 0 8px">سند · مراقبة أنظمة لوكارب</h2><ul style="padding-inline-start:18px">${list}</ul><p style="color:#777;font-size:13px">سند يفحص أنظمتك كل 5 دقايق. <a href="https://badteam.github.io/locarb-hr/monitor">افتح صفحة سند</a></p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "سند - LoCarb <onboarding@resend.dev>", to, subject, html }),
  });
  const body = await res.text();
  if (!res.ok) console.error("resend", res.status, body);
  return { sent: res.ok, status: res.status, body: body.slice(0, 300) };
}

Deno.serve(async (req) => {
  const { data: expected } = await db.rpc("get_app_secret", { p_key: "monitor_run_token" });
  const given = req.headers.get("x-monitor-token") ?? "";
  if (!expected || !same(given, expected)) return json({ error: "unauthorized" }, 401);
  const input = await req.json().catch(() => ({}));

  if (input?.test_email) {
    const { data: s } = await db.from("monitor_settings").select("alert_emails").eq("id", 1).single();
    const r = await sendEmail(s?.alert_emails || [], "سند · رسالة تجربة", [{ kind: "info", text: "هذي رسالة تجربة من سند. لو وصلتك، التحذيرات بتوصلك هنا لما يطيح أي نظام." }]);
    return json({ ok: true, test: r });
  }

  const { data: targets, error } = await db.from("monitor_targets").select("*").eq("active", true);
  if (error) return json({ error: error.message }, 500);
  const results = await Promise.all((targets || []).map(check));
  const { data, error: e2 } = await db.rpc("monitor_record", { p: results });
  if (e2) return json({ error: e2.message }, 500);
  let email = null;
  if (data?.changes?.length) {
    const down = data.changes.filter((c: any) => c.kind === "down");
    const subject = down.length ? `سند · عطل: ${down.map((c: any) => c.name).join("، ")}` : `سند · رجع يشتغل: ${data.changes.map((c: any) => c.name).join("، ")}`;
    email = await sendEmail(data.emails || [], subject, data.changes);
  }
  return json({ ok: true, recorded: data?.recorded, changes: data?.changes, email });
});
