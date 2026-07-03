const CURRENT_KEY = "current";
const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/current") {
      return json(await currentTunnel(env));
    }

    if (request.method === "POST" && url.pathname === "/register") {
      return json(await registerTunnel(request, env));
    }

    return json({ ok: false, error: "not_found" }, 404);
  }
};

async function currentTunnel(env) {
  const stored = await env.TUNNEL_KV.get(CURRENT_KEY, "json");
  if (!stored?.apiBase) {
    return { ok: false, status: "missing" };
  }

  const ageSeconds = Math.round((Date.now() - Date.parse(stored.updatedAt || 0)) / 1000);
  const maxAgeSeconds = Number(env.MAX_TUNNEL_AGE_SECONDS || DEFAULT_MAX_AGE_SECONDS);
  if (!Number.isFinite(ageSeconds) || ageSeconds > maxAgeSeconds) {
    return { ok: false, status: "stale", apiBase: stored.apiBase, updatedAt: stored.updatedAt };
  }

  const health = await fetchHealth(stored.apiBase);
  if (!health.ok) {
    return {
      ok: false,
      status: "unreachable",
      apiBase: stored.apiBase,
      updatedAt: stored.updatedAt,
      error: health.error
    };
  }

  return {
    ok: true,
    status: "online",
    apiBase: stored.apiBase,
    updatedAt: stored.updatedAt,
    health: health.payload
  };
}

async function registerTunnel(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return { ok: false, error: "invalid_json" };
  }

  const apiBase = normalizeApiBase(payload.apiBase || payload.url);
  if (!isAllowedTunnelUrl(apiBase)) {
    return { ok: false, error: "invalid_tunnel_url" };
  }

  const health = await fetchHealth(apiBase);
  if (!health.ok) {
    return { ok: false, error: "health_check_failed", detail: health.error };
  }

  const record = {
    apiBase,
    updatedAt: new Date().toISOString()
  };
  await env.TUNNEL_KV.put(CURRENT_KEY, JSON.stringify(record), {
    expirationTtl: Number(env.MAX_TUNNEL_AGE_SECONDS || DEFAULT_MAX_AGE_SECONDS)
  });

  return { ok: true, ...record };
}

function normalizeApiBase(value) {
  return String(value || "").replace(/\/$/, "");
}

function isAllowedTunnelUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
}

async function fetchHealth(apiBase) {
  try {
    const response = await fetch(`${apiBase}/health`, {
      cf: { cacheTtl: 0 },
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const payload = await response.json();
    if (payload?.ok !== true || !payload?.storage || !payload?.worker) {
      return { ok: false, error: "not_codex_reader" };
    }
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, error: error.message || "fetch_failed" };
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
