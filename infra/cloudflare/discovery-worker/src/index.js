const CURRENT_KEY = "current";
const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/current") {
      return json(await currentTunnel(env, url));
    }

    if (request.method === "POST" && url.pathname === "/register") {
      return json(await registerTunnel(request, env));
    }

    if (url.pathname.startsWith("/proxy/")) {
      return proxyToCurrentTunnel(request, env, url);
    }

    return json({ ok: false, error: "not_found" }, 404);
  }
};

async function currentTunnel(env, requestUrl) {
  const stored = await getCurrentTunnelRecord(env);
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
    proxyBase: requestUrl ? `${requestUrl.origin}/proxy` : "",
    updatedAt: stored.updatedAt,
    health: health.payload
  };
}

async function proxyToCurrentTunnel(request, env, requestUrl) {
  if (!["GET", "POST", "DELETE", "HEAD"].includes(request.method)) {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const stored = await getCurrentTunnelRecord(env);
  if (!stored?.apiBase) {
    return json({ ok: false, error: "missing_tunnel" }, 503);
  }

  const ageSeconds = Math.round((Date.now() - Date.parse(stored.updatedAt || 0)) / 1000);
  const maxAgeSeconds = Number(env.MAX_TUNNEL_AGE_SECONDS || DEFAULT_MAX_AGE_SECONDS);
  if (!Number.isFinite(ageSeconds) || ageSeconds > maxAgeSeconds) {
    return json({ ok: false, error: "stale_tunnel", updatedAt: stored.updatedAt }, 503);
  }

  const upstreamPath = requestUrl.pathname.replace(/^\/proxy/, "") || "/";
  const upstreamUrl = new URL(`${upstreamPath}${requestUrl.search}`, stored.apiBase);
  const headers = new Headers(request.headers);
  headers.delete("host");

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
      cf: { cacheTtl: 0 }
    });
  } catch (error) {
    return json({ ok: false, error: "proxy_fetch_failed", detail: error.message || "fetch_failed" }, 502);
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    responseHeaders.set(key, value);
  }
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges,Content-Type");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}

async function getCurrentTunnelRecord(env) {
  return env.TUNNEL_KV.get(CURRENT_KEY, "json");
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
    "Access-Control-Allow-Headers": "Content-Type,X-Codex-Reader-Token,CF-Access-Jwt-Assertion,Range"
  };
}
