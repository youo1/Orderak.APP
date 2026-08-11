const PREVIEW_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'";

function secureAdminApiResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: EdgeEnv): Promise<Response> {
    const incoming = new URL(request.url);
    if (incoming.hostname !== env.CANONICAL_HOST) return new Response("Not found", { status: 404 });

    if (incoming.pathname.startsWith("/api/admin/v1/")) {
      return secureAdminApiResponse(await env.ADMIN_WORKER.fetch(request));
    }

    if (incoming.pathname === "/theme.css") {
      const theme = await fetch(`${env.THEME_ORIGIN}/api/theme.css`, {
        headers: { accept: "text/css" },
        redirect: "follow",
      });
      const headers = new Headers(theme.headers);
      headers.set("content-type", "text/css; charset=utf-8");
      headers.set("cache-control", "public, max-age=60");
      headers.delete("set-cookie");
      return new Response(theme.body, { status: theme.status, headers });
    }

    const asset = await env.ASSETS.fetch(request);
    if (incoming.pathname !== "/theme-preview" && incoming.pathname !== "/theme-preview.html") return asset;
    const headers = new Headers(asset.headers);
    headers.set("content-security-policy", PREVIEW_CSP);
    headers.set("x-frame-options", "SAMEORIGIN");
    headers.set("cache-control", "no-store");
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  },
};
