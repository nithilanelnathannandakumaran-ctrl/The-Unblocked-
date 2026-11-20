const LOGOS = ["circle", "triangle", "square", "star", "hex", "diamond", "cross", "moon"];

const enc = new TextEncoder();
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const ID_OK = /^[a-z0-9-]{8,40}$/;

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function makeToken(env) {
  const exp = Date.now() + 2 * 60 * 60 * 1000;
  return exp + "." + (await hmac(env.SESSION_SECRET, "admin:" + exp));
}
async function isAdmin(req, env) {
  const h = req.headers.get("Authorization") || "";
  if (!h.startsWith("Bearer ") || !env.SESSION_SECRET) return false;
  const [exp, sig] = h.slice(7).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEq(sig, await hmac(env.SESSION_SECRET, "admin:" + exp));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (req.method === "GET" && p === "/api/apps") {
      const { results } = await env.DB.prepare(
        "SELECT id, name, desc, file, size, created_at AS t, (SELECT COUNT(*) FROM chunks WHERE app_id = apps.id) AS chunks FROM apps ORDER BY created_at DESC"
      ).all();
      return json(results);
    }

    if (req.method === "GET" && p.startsWith("/api/chunk/")) {
      const [id, nStr] = p.slice(11).split("/");
      const n = Number(nStr);
      if (!ID_OK.test(id || "") || !Number.isInteger(n) || n < 0) return new Response("bad", { status: 400 });
      const row = await env.DB.prepare("SELECT data FROM chunks WHERE app_id = ? AND n = ?").bind(id, n).first();
      if (!row) return new Response("Not found", { status: 404 });
      if (n === 0) await env.DB.prepare("UPDATE apps SET downloads = downloads + 1 WHERE id = ?").bind(id).run();
      return new Response(row.data, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    }

    if (req.method === "POST" && p === "/api/message") {
      let b; try { b = await req.json(); } catch { return json({}, 400); }
      const text = String(b.text || "").trim().slice(0, 500);
      const contact = String(b.contact || "").trim().slice(0, 100);
      const kind = b.kind === "request" ? "request" : "question";
      if (!text) return json({ error: "empty" }, 400);
      const ip = req.headers.get("CF-Connecting-IP") || "unknown";
      const now = Date.now();
      const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE ip = ? AND created_at > ?").bind(ip, now - 600000).first();
      if (c.n >= 3) return json({ error: "slow down" }, 429);
      await env.DB.prepare("INSERT INTO messages (kind, text, contact, ip, created_at) VALUES (?, ?, ?, ?, ?)").bind(kind, text, contact, ip, now).run();
      return json({ ok: true });
    }

    if (req.method === "POST" && p === "/api/unlock") {
      let body; try { body = await req.json(); } catch { return json({}, 400); }
      const seq = Array.isArray(body.seq) ? body.seq.filter(x => LOGOS.includes(x)) : [];
      const want = (env.ADMIN_SEQUENCE || "").split(",").map(s => s.trim()).filter(Boolean);
      const ip = req.headers.get("CF-Connecting-IP") || "unknown";
      const now = Date.now();
      await env.DB.prepare("DELETE FROM login_attempts WHERE t < ?").bind(now - 600000).run();
      const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ?").bind(ip).first();
      if (fails.n >= 5) return json({ ok: false }, 429);
      await new Promise(r => setTimeout(r, 400));
      if (!want.length || !env.SESSION_SECRET || !safeEq(seq.join(","), want.join(","))) {
        await env.DB.prepare("INSERT INTO login_attempts (ip, t) VALUES (?, ?)").bind(ip, now).run();
        return json({ ok: false }, 401);
      }
      return json({ ok: true, token: await makeToken(env) });
    }

    if (p.startsWith("/api/admin/")) {
      if (!(await isAdmin(req, env))) return json({ error: "no" }, 401);

      if (req.method === "PUT" && p.startsWith("/api/admin/chunk/")) {
        const [id, nStr] = p.slice(17).split("/");
        const n = Number(nStr);
        if (!ID_OK.test(id || "") || !Number.isInteger(n) || n < 0 || n > 200) return json({ error: "bad" }, 400);
        const data = await req.text();
        if (!data || data.length > 1500000) return json({ error: "bad size" }, 400);
        await env.DB.prepare("INSERT OR REPLACE INTO chunks (app_id, n, data) VALUES (?, ?, ?)").bind(id, n, data).run();
        return json({ ok: true });
      }

      if (req.method === "POST" && p === "/api/admin/finish") {
        let b; try { b = await req.json(); } catch { return json({}, 400); }
        const id = String(b.id || "");
        const name = String(b.name || "").trim().slice(0, 80);
        const desc = String(b.desc || "").trim().slice(0, 200);
        const file = String(b.file || "").trim().slice(0, 120);
        const size = Number(b.size) || 0;
        if (!ID_OK.test(id) || !name || !file) return json({ error: "bad" }, 400);
        const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM chunks WHERE app_id = ?").bind(id).first();
        if (!c.n) return json({ error: "no data" }, 400);
        await env.DB.prepare("INSERT INTO apps (id, name, desc, file, size, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(id, name, desc, file, size, Date.now()).run();
        return json({ ok: true });
      }

      if (req.method === "GET" && p === "/api/admin/messages") {
        const { results } = await env.DB.prepare("SELECT id, kind, text, contact, created_at FROM messages ORDER BY created_at DESC LIMIT 200").all();
        return json(results);
      }

      if (req.method === "DELETE" && p.startsWith("/api/admin/message/")) {
        await env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(Number(p.slice(19))).run();
        return json({ ok: true });
      }

      if (req.method === "DELETE" && p.startsWith("/api/admin/app/")) {
        const id = decodeURIComponent(p.slice(15));
        await env.DB.prepare("DELETE FROM chunks WHERE app_id = ?").bind(id).run();
        await env.DB.prepare("DELETE FROM apps WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }
    }

    return new Response("Not found", { status: 404 });
  }
};
