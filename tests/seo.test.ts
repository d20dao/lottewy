import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  applySeo,
  routeSeo,
  HOME_DESCRIPTION,
  HOME_TITLE,
  seoHead,
} from "../shared/seo";

it("keeps public metadata consistent without test/demo claims or em dashes", () => {
  const html = readFileSync("index.html", "utf8"),
    head = seoHead(routeSeo("/"));
  expect(html).toContain(HOME_TITLE);
  expect(html).toContain(HOME_DESCRIPTION);
  expect(head).not.toMatch(/testnet|demo|—/i);
  expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
  expect(head).toContain('rel="canonical" href="https://lottewy.com/"');
  const json = head.match(/<script[^>]+>(.*?)<\/script>/)![1];
  expect(JSON.parse(json)).toMatchObject({
    "@type": "WebSite",
    name: "Lottewy",
    url: "https://lottewy.com/",
  });
});
it("never indexes a private route or a testnet host and removes the homepage schema", () => {
  for (const path of [
    "/create",
    "/dashboard",
    "/history",
    "/edit/123",
    "/admin",
    "/agent/123",
    "/demo",
  ]) {
    const html = applySeo(readFileSync("index.html", "utf8"), routeSeo(path));
    expect(html).toContain('content="noindex,nofollow"');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('id="site-schema"');
  }
  const testnet = seoHead(routeSeo("/", "https://testnet.lottewy.com"));
  expect(testnet).toContain("noindex,nofollow");
  expect(testnet).not.toContain('rel="canonical"');
});
it("escapes organizer content in server-rendered titles and social metadata", () => {
  const html = applySeo(readFileSync("index.html", "utf8"), {
    ...routeSeo("/explorer"),
    title: 'Title </title><script>alert(1)</script> "$&"',
    description: '"/><img src=x onerror=alert(1)>',
  });
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).not.toContain("<img src=x");
  expect(html).toContain("&lt;/title&gt;");
  expect(html).toContain("$&");
  expect(html.match(/<title>/g)).toHaveLength(1);
});
