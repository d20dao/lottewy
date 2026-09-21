export const SITE_ORIGIN = "https://lottewy.com";
export const HOME_TITLE = "Lottewy | Verifiable Giveaways for Web3 Communities";
export const HOME_DESCRIPTION =
  "Run Discord and Web3 community giveaways with verifiable randomness on the Arc Network. Import entries, choose winners and share the proof.";
export const EXPLORER_DESCRIPTION =
  "Explore public giveaways on Lottewy. See each organizer's rules, participant commitments and recorded results, then verify the selection.";
export type PageSeo = {
  title: string;
  description: string;
  indexable: boolean;
  path?: string;
  origin: string;
  website?: boolean;
};
export const isPublicOrigin = (origin: string) => {
  try {
    return ["lottewy.com", "www.lottewy.com"].includes(
      new URL(origin).hostname,
    );
  } catch {
    return false;
  }
};
export function routeSeo(path: string, origin = SITE_ORIGIN): PageSeo {
  const base = { origin, indexable: false };
  if (path === "/")
    return {
      ...base,
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      indexable: isPublicOrigin(origin),
      path,
      website: true,
    };
  if (path === "/explorer")
    return {
      ...base,
      title: "Public Giveaway Results | Lottewy",
      description: EXPLORER_DESCRIPTION,
      indexable: isPublicOrigin(origin),
      path,
    };
  const title =
    path === "/create"
      ? "Create a Giveaway"
      : path === "/dashboard"
        ? "My Giveaways"
        : path === "/history"
          ? "Giveaway Activity"
          : path.startsWith("/edit/")
            ? "Edit Giveaway"
            : path === "/admin"
              ? "Administration"
              : path.startsWith("/g/") || path.startsWith("/agent/")
                ? "Giveaway"
                : "Page Not Found";
  return {
    ...base,
    title: title + " | Lottewy",
    description:
      "Manage giveaway entries and rules, and verify recorded results with Lottewy.",
  };
}
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
export const robotsFor = (meta: PageSeo) =>
  meta.indexable ? "index,follow,max-image-preview:large" : "noindex,nofollow";
export function websiteData(origin = SITE_ORIGIN) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Lottewy",
    url: origin + "/",
    description: HOME_DESCRIPTION,
    inLanguage: "en",
  };
}
export function seoHead(meta: PageSeo) {
  const title = escape(meta.title),
    description = escape(meta.description),
    image = escape(meta.origin + "/brand/lottewy-og.png");
  const canonical =
    meta.indexable && meta.path ? escape(meta.origin + meta.path) : null;
  return `<title>${title}</title>
<meta name="description" content="${description}" />
<meta name="robots" content="${robotsFor(meta)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Lottewy" />
<meta property="og:locale" content="en_US" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Lottewy. Pick winners. Show the proof." />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${image}" />
<meta name="twitter:image:alt" content="Lottewy. Pick winners. Show the proof." />
${canonical ? `<link rel="canonical" href="${canonical}" /><meta property="og:url" content="${canonical}" />` : ""}
${meta.website && meta.indexable ? `<script id="site-schema" type="application/ld+json">${JSON.stringify(websiteData(meta.origin)).replaceAll("<", "\\u003c")}</script>` : ""}`;
}
export function applySeo(html: string, meta: PageSeo) {
  return html.replace(
    /<!-- lottewy:seo:start -->[\s\S]*?<!-- lottewy:seo:end -->/,
    () =>
      `<!-- lottewy:seo:start -->\n${seoHead(meta)}\n<!-- lottewy:seo:end -->`,
  );
}
