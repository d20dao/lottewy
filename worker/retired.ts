export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    const headers = {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    };
    if (url.pathname === "/robots.txt")
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
      });
    if (url.pathname.startsWith("/api/"))
      return Response.json(
        { error: "Testnet has been retired", mainnet: "https://lottewy.com" },
        { status: 410, headers },
      );
    return new Response(
      '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Lottewy is on mainnet</title><style>body{margin:0;background:#fafbf7;color:#20271b;font:17px/1.7 system-ui}main{max-width:640px;margin:15vh auto;padding:24px}a{color:#365f18}h1{line-height:1.15}</style><main><h1>Lottewy is on mainnet.</h1><p>This testnet service has been retired. Start new giveaways on Arc Mainnet. Old testnet records are not mainnet results.</p><a href="https://lottewy.com">Continue to Lottewy →</a></main></html>',
      {
        status: 410,
        headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
      },
    );
  },
};
