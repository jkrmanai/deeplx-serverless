// Self-contained DeepLX-compatible worker backed by the DeepL oneshot
// endpoint (the same one the official DeepL Chrome/iOS clients use).
// No dependencies; paste-ready for the Cloudflare dashboard editor.

const UPSTREAM = "https://oneshot-free.www.deepl.com/v1/translate";

const APP_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "DeepL/26.42 CFNetwork/3826.500.62.2.1 Darwin/24.4.0",
  "x-app-os-name": "iOS",
  "x-app-os-version": "26.0",
  "x-app-device": "iPhone16,2",
  "x-app-build": "5443737",
  "x-app-version": "26.42",
  "x-product": "translator",
  Referer: "https://www.deepl.com/",
};

// Normalize common language codes to the oneshot endpoint's expectations.
function normLang(code, isTarget) {
  if (!code) return "";
  const c = String(code).trim().toLowerCase();
  if (c === "zh" || c === "zh-cn" || c === "zh-hans" || c === "zh-sg") return "zh-Hans";
  if (c === "zh-tw" || c === "zh-hk" || c === "zh-hant" || c === "zh-mo") return "zh-Hant";
  if (c === "auto" || c === "") return "";
  if (c === "en" && isTarget) return "en-US";
  return c;
}

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign(
      {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      extra || {},
    ),
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return json(null, 204);
    }

    if (!url.pathname.startsWith("/translate")) {
      return json({ code: 404, msg: "Not found" }, 404);
    }

    // Token auth: Authorization: Bearer <token> or ?token=<token>.
    // If env.token is unset, the endpoint is open (set a token in production).
    if (env.token) {
      const auth = request.headers.get("authorization") || "";
      const bearer = auth.toLowerCase().startsWith("bearer ")
        ? auth.slice(7)
        : "";
      const query = url.searchParams.get("token") || "";
      if (bearer !== env.token && query !== env.token) {
        return json(
          { code: 403, msg: "Request missing authentication information" },
          403,
        );
      }
    }

    if (request.method !== "POST") {
      return json({ code: 404, msg: "Not found" }, 404);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ code: 400, msg: "Invalid JSON body" }, 400);
    }

    const text = body.text;
    const fromRaw = body.from || body.source_lang || "";
    const toRaw = body.to || body.target_lang || "";
    if (!text || !toRaw) {
      return json({ code: 404, msg: "Not found" }, 404);
    }

    const from = normLang(fromRaw, false);
    const to = normLang(toRaw, true);

    const payload = {
      text: [text],
      target_lang: to,
      usage_type: "translate",
      app_information: {
        os: "iOS",
        os_version: "26.0",
        app_version: "26.42",
        app_build: "5443737",
        instance_id: crypto.randomUUID(),
      },
    };
    if (from) {
      payload.source_lang = from;
    }

    let data;
    try {
      const resp = await fetch(UPSTREAM, {
        method: "POST",
        headers: APP_HEADERS,
        body: JSON.stringify(payload),
      });
      data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error || !data.translations) {
        return json(
          {
            code: resp.status || 503,
            msg: data.message || "Translation failed",
          },
          resp.status || 503,
        );
      }
    } catch (e) {
      return json(
        {
          code: 503,
          msg:
            "upstream fetch failed: " +
            (e && e.message ? e.message : String(e)),
        },
        503,
      );
    }

    const t = data.translations[0] || {};
    return json(
      {
        code: 200,
        id: Date.now(),
        data: t.text || "",
        alternatives: [],
        source_lang: (t.detected_source_language || from || "").toUpperCase(),
        target_lang: toRaw.toUpperCase(),
        method: "Free",
      },
      200,
    );
  },
};
