const DISCOVERY_PROXY_BASE = "https://pdf-study-discovery.jirehkwon.workers.dev/proxy";

export async function onRequest(context) {
  const { request } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!["GET", "POST", "DELETE", "HEAD"].includes(request.method)) {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const requestUrl = new URL(request.url);
  const upstreamPath = requestUrl.pathname.replace(/^\/api/, "/api") || "/api";
  const upstreamUrl = `${DISCOVERY_PROXY_BASE}${upstreamPath}${requestUrl.search}`;
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
    return json({ ok: false, error: "pages_proxy_failed", detail: error.message || "fetch_failed" }, 502);
  }

  const responseHeaders = new Headers(upstream.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    responseHeaders.set(key, value);
  }
  responseHeaders.set("Cache-Control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
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
    "Access-Control-Allow-Methods": "GET,POST,DELETE,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Codex-Reader-Token,CF-Access-Jwt-Assertion,Range",
    "Access-Control-Expose-Headers": "Content-Length,Content-Range,Accept-Ranges,Content-Type"
  };
}
