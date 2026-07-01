/* Waitlist capture — Cloudflare Pages Function.
 * POST /api/waitlist  { email, website? }  (JSON or form-encoded)
 * Stores to the KV namespace bound as `WAITLIST`, keyed `<host>:<email>` so each
 * site keeps its own list (prefix-scannable). `website` is a honeypot.
 * Same code is deployed to minspec.dev, scroogellm.com and sealbox.dev.
 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function wantsJson(request) {
  const a = request.headers.get("accept") || "";
  const x = request.headers.get("x-requested-with") || "";
  const c = request.headers.get("content-type") || "";
  return a.includes("application/json") || x === "XMLHttpRequest" || c.includes("application/json");
}

function reply(request, status, payload, redirectQuery) {
  if (wantsJson(request)) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  // No-JS fallback: bounce back to the page with a status flag.
  const origin = new URL(request.url).origin;
  return Response.redirect(origin + "/?w=" + (redirectQuery || (payload.ok ? "ok" : "err")), 303);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let email = "";
  let honeypot = "";
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const b = await request.json();
      email = (b.email || "").toString().trim();
      honeypot = (b.website || "").toString();
    } else {
      const f = await request.formData();
      email = (f.get("email") || "").toString().trim();
      honeypot = (f.get("website") || "").toString();
    }
  } catch (_e) {
    return reply(request, 400, { ok: false, error: "Malformed request." });
  }

  // Bot trap: pretend success, store nothing.
  if (honeypot) return reply(request, 200, { ok: true });

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return reply(request, 400, { ok: false, error: "Please enter a valid email address." });
  }

  if (!env.WAITLIST) {
    return reply(request, 503, { ok: false, error: "Waitlist storage is not configured yet." });
  }

  const host = (request.headers.get("host") || "unknown").toLowerCase();
  const key = host + ":" + email.toLowerCase();
  const record = {
    email,
    site: host,
    ts: new Date().toISOString(),
    ref: request.headers.get("referer") || null,
    ua: (request.headers.get("user-agent") || "").slice(0, 256),
    ip: request.headers.get("cf-connecting-ip") || null,
    country: (request.cf && request.cf.country) || null,
  };

  try {
    // metadata mirrors site+ts so a list() can show entries without a get() per key.
    await env.WAITLIST.put(key, JSON.stringify(record), {
      metadata: { site: host, ts: record.ts },
    });
  } catch (_e) {
    return reply(request, 500, { ok: false, error: "Could not save your spot. Please try again." });
  }

  return reply(request, 200, { ok: true });
}

// Only POST is handled; Pages returns 405 for other methods automatically.
