import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const browser = await chromium.launch({ channel: "msedge" });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function render(source, target, width, height) {
    await page.setViewportSize({ width, height });
    const svg = readFileSync(source, "utf8");
    await page.setContent(
      `<html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${svg}</body></html>`,
    );
    await page.screenshot({ path: target, omitBackground: true });
  }
  await render(
    "public/brand/lottewy-og.svg",
    "public/brand/lottewy-og.png",
    1200,
    630,
  );
  for (const size of [16, 32, 180])
    await render(
      "public/brand/lottewy-favicon.svg",
      `public/brand/${size === 180 ? "apple-touch-icon" : `favicon-${size}`}.png`,
      size,
      size,
    );
  const png = readFileSync("public/brand/favicon-32.png"),
    header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 32;
  header[7] = 32;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  writeFileSync("public/favicon.ico", Buffer.concat([header, png]));
  console.log(
    "Rendered OG 1200×630, favicon 16/32, Apple touch 180 and favicon.ico from the SVG brand assets.",
  );
} finally {
  await browser.close();
}
