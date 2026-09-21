import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export function buildFavicon() {
  const sizes = [16, 32],
    images = sizes.map((size) =>
      readFileSync(`public/brand/favicon-${size}.png`),
    );
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((bytes, i) => {
    const entry = 6 + 16 * i;
    header[entry] = sizes[i];
    header[entry + 1] = sizes[i];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(bytes.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
  });
  writeFileSync("public/favicon.ico", Buffer.concat([header, ...images]));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  buildFavicon();
