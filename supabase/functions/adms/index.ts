import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Receiver for ZKTeco fingerprint devices (ADMS / "Cloud Server" push protocol).
// The devices can't speak HTTPS, so they talk plain HTTP to a small relay on the
// Hostinger server, which forwards here with a shared token in x-relay-token.
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

let relayToken: string | null = null;
let tokenAt = 0;
async function token() {
  if (!relayToken || Date.now() - tokenAt > 5 * 60_000) {
    const { data } = await db.rpc("get_app_secret", { p_key: "adms_relay_token" });
    relayToken = data ?? null;
    tokenAt = Date.now();
  }
  return relayToken;
}

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain" } });

const lines = (body: string) => body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// "PIN=1\tName=Ali\tPri=0" or "pin=1\tname=Ali" -> { pin: "1", name: "Ali", pri: "0" }
const kv = (s: string) => {
  const o: Record<string, string> = {};
  for (const part of s.split("\t")) {
    const i = part.indexOf("=");
    if (i > 0) o[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return o;
};

const TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function parseAttlog(body: string) {
  const rows = [];
  for (const l of lines(body)) {
    const f = l.split("\t");
    const pin = (f[0] ?? "").trim();
    const time = (f[1] ?? "").trim();
    if (!/^\d{1,9}$/.test(pin) || !TIME.test(time)) continue;
    rows.push({ pin, time, status: f[2] ?? "", verify: f[3] ?? "", raw: l.slice(0, 200) });
  }
  return rows;
}

function parseUsers(body: string) {
  const rows = [];
  for (const l of lines(body)) {
    const sp = l.indexOf(" ");
    const head = (sp > 0 ? l.slice(0, sp) : l).toUpperCase();
    const o = kv(sp > 0 ? l.slice(sp + 1) : l);
    const pin = o.pin;
    if (!pin || !/^\d{1,9}$/.test(pin)) continue;
    if (head === "USER") rows.push({ pin, name: o.name ?? "", pri: o.pri ?? o.privilege ?? "", card: o.card ?? o.cardno ?? "" });
    else if (head === "FP" || head === "BIODATA") rows.push({ pin, fp: true });
  }
  return rows;
}

function parseCmdResults(body: string) {
  const rows = [];
  for (const l of lines(body)) {
    const p = new URLSearchParams(l);
    const id = p.get("ID"), ret = p.get("Return");
    if (id && /^\d+$/.test(id) && ret && /^-?\d+$/.test(ret)) rows.push({ id, ret });
  }
  return rows;
}

const options = (sn: string) => [
  `GET OPTION FROM: ${sn}`,
  "ATTLOGStamp=None",
  "OPERLOGStamp=9999",
  "ATTPHOTOStamp=None",
  "ErrorDelay=30",
  "Delay=5",
  "TransTimes=00:00;14:05",
  "TransInterval=1",
  "TransFlag=TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP",
  "TimeZone=3",
  "Realtime=1",
  "Encrypt=None",
].join("\n") + "\n";

async function ingest(sn: string, ip: string, kind: string, rows: unknown[] = [], info: unknown = null) {
  const { data, error } = await db.rpc("bio_ingest", { p_serial: sn, p_ip: ip, p_kind: kind, p_rows: rows, p_info: info });
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(async (req) => {
  const t = await token();
  if (!t || req.headers.get("x-relay-token") !== t) return text("forbidden", 403);

  const path = (req.headers.get("x-orig-path") ?? "").toLowerCase();
  const q = new URLSearchParams(req.headers.get("x-orig-query") ?? "");
  const ip = (req.headers.get("x-device-ip") ?? "").slice(0, 60);
  const sn = q.get("SN") ?? q.get("sn") ?? "";
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(sn)) return text("OK");
  const body = req.method === "POST" ? await req.text() : "";

  try {
    if (path.endsWith("/cdata")) {
      if (req.method === "GET") {
        const info: Record<string, string> = {};
        for (const k of ["pushver", "language", "DeviceType", "pushcommkey"]) if (q.get(k)) info[k] = q.get(k)!;
        await ingest(sn, ip, "hello", [], Object.keys(info).length ? info : null);
        return text(options(sn));
      }
      const table = (q.get("table") ?? "").toUpperCase();
      if (table === "ATTLOG") {
        const rows = parseAttlog(body);
        for (let i = 0; i < rows.length; i += 500) await ingest(sn, ip, "attlog", rows.slice(i, i + 500));
        return text(`OK: ${rows.length}`);
      }
      if (table === "OPERLOG" || table === "USERINFO" || table === "BIODATA") {
        const rows = parseUsers(body);
        for (let i = 0; i < rows.length; i += 500) await ingest(sn, ip, "users", rows.slice(i, i + 500));
        if (!rows.length) await ingest(sn, ip, "hello");
        return text(`OK: ${lines(body).length}`);
      }
      await ingest(sn, ip, "hello");
      return text(`OK: ${lines(body).length}`);
    }

    if (path.endsWith("/querydata")) {
      const rows = parseUsers(body);
      for (let i = 0; i < rows.length; i += 500) await ingest(sn, ip, "users", rows.slice(i, i + 500));
      return text(`OK: ${rows.length}`);
    }

    if (path.endsWith("/getrequest")) {
      const info = q.get("INFO");
      const r = await ingest(sn, ip, "getrequest", [], info ? { INFO: info.slice(0, 200) } : null);
      const cmds = (r?.commands ?? []) as { id: number; command: string }[];
      if (!cmds.length) return text("OK");
      return text(cmds.map((c) => `C:${c.id}:${c.command}`).join("\n") + "\n");
    }

    if (path.endsWith("/devicecmd")) {
      await ingest(sn, ip, "cmdresult", parseCmdResults(body));
      return text("OK");
    }

    await ingest(sn, ip, "hello");
    return text("OK");
  } catch (e) {
    console.error("adms", sn, path, (e as Error).message);
    return text("ERROR", 500);
  }
});
