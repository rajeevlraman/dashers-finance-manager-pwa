// merchantLogos.js
// Maps merchant/retailer/bank keywords found in a transaction description →
// the logo image filename in /assets/logos/.
//
// Bug fixes (previously): this list only covered ~15 of the 52 logo images
// that actually exist in /assets/logos/, and several filenames didn't match
// the real files' capitalization at all (e.g. mapped to "kfc.png" while the
// real file is "KFC.png", "mcdonalds.png" vs the real "macDonalds.png",
// "ebgames.png" vs "ebGames.png", "chemistwarehouse.png" vs
// "chemistWarehouse.png", "caseykebab.png" vs "caseyKebab.png"). On
// case-sensitive hosting (GitHub Pages, most Linux servers) those would
// 404 and silently fall back to no logo — this list now uses the exact
// on-disk filenames throughout. See tests/merchantLogos.test.js, which
// asserts every filename listed here actually exists on disk.
//
// Also fixed: logo paths used to start with a leading "/" (absolute from
// domain root), which breaks on any hosting that isn't served from exactly
// the domain root — the same class of bug as the earlier <base href> issue.
// Paths here are relative ("assets/logos/...") so they resolve correctly
// wherever the app is actually hosted.
//
// ORDER MATTERS: getMerchantLogo() returns the first match, so more
// specific keywords (e.g. "amazon web services") must come before more
// general ones that would otherwise swallow them (e.g. "amazon").

export const MERCHANT_LOGOS = [
  // --- Amazon family (specific entries BEFORE the generic "amazon" one) ---
  { keywords: ["amazon web services", "aws"], logo: "amazonwebservices.png" },
  { keywords: ["amazon music", "amazonmusic"], logo: "amazonmusic.jpeg" },
  { keywords: ["amazon"], logo: "amazon.png" },

  // --- Supermarkets & grocers ---
  { keywords: ["woolworths", "woolies"], logo: "woolworths.png" },
  { keywords: ["coles"], logo: "coles.png" },
  { keywords: ["iga"], logo: "iga.png" },
  { keywords: ["aldi"], logo: "aldi.png" },
  { keywords: ["malvic"], logo: "malvic.png" },
  { keywords: ["marketplace fresh", "marketplace"], logo: "marketplace.jpeg" },
  { keywords: ["aangan"], logo: "aangan.png" },
  { keywords: ["vel spices", "velspices"], logo: "velspices.png" },
  { keywords: ["big w", "bigw"], logo: "bigw.jpg" },

  // --- Smart home hardware (kept BEFORE the fuel section below —
  // "shelly" contains "shell" as a substring, and getMerchantLogo()
  // returns the first keyword match, so the Shell fuel-station entry
  // was silently swallowing every Shelly smart-plug purchase and
  // showing the wrong logo entirely) ---
  { keywords: ["sonoff"], logo: "sonoff.png" },
  { keywords: ["shelly"], logo: "shelly.png" },

  // --- Convenience / fuel ---
  { keywords: ["7-eleven", "7 eleven", "711"], logo: "711.png" },
  { keywords: ["apco"], logo: "apcofuel.png" },
  { keywords: ["shell"], logo: "shell.jpeg" },
  { keywords: ["reddy express", "reddy fuel", "reddyfuel"], logo: "reddyfuel.png" },
  { keywords: ["united petroleum", "united fuel", "unitedfuel"], logo: "unitedfuel.png" },

  // --- Fast food & takeaway ---
  { keywords: ["mcd", "mcdonald", "maccas"], logo: "macDonalds.png" },
  { keywords: ["kfc"], logo: "KFC.png" },
  { keywords: ["hungry jack", "hungryjacks"], logo: "hungryjacks.jpeg" },
  { keywords: ["domino"], logo: "dominos.png" },
  { keywords: ["guzman", "gyg"], logo: "guzmanygomez.jpeg" },
  { keywords: ["boost juice", "boostjuice"], logo: "boostjuice.jpeg" },
  { keywords: ["uber eats", "ubereats"], logo: "ubereats.jpeg" },
  { keywords: ["casey kebab"], logo: "caseyKebab.png" },
  { keywords: ["nando"], logo: "nandos.jpg" },

  // --- Department / retail stores ---
  { keywords: ["bunnings"], logo: "bunnings.png" },
  { keywords: ["kmart"], logo: "kmart.jpeg" },
  { keywords: ["target"], logo: "target.jpeg" },
  { keywords: ["myer"], logo: "myer.png" },
  { keywords: ["jb hi-fi", "jb hifi", "jbhifi"], logo: "jbhifi.jpeg" },
  { keywords: ["eb games", "ebgames"], logo: "ebGames.png" },
  { keywords: ["rebel sport", "rebelsports"], logo: "rebelsports.jpeg" },
  { keywords: ["uniqlo"], logo: "uniqlo.png" },
  { keywords: ["temu"], logo: "temu.png" },
  { keywords: ["westfield"], logo: "westfield.jpeg" },
  { keywords: ["petstock"], logo: "petstock.jpeg" },
  { keywords: ["aliexpress"], logo: "aliexpress.png" },
  { keywords: ["harvey norman", "harveynorman"], logo: "harveynorman.jpg" },
  { keywords: ["good guys", "goodguys"], logo: "goodguys.png" },

  // --- Health / chemist ---
  { keywords: ["chemist warehouse"], logo: "chemistWarehouse.png" },
  { keywords: ["medicare"], logo: "medicare.png" },
  { keywords: ["ambulance victoria", "ambulancevictoria"], logo: "ambulancevictoria.jpeg" },
  { keywords: ["specsavers", "spec savers"], logo: "specsavers.jpg" },

  // --- Energy / utilities ---
  { keywords: ["globird"], logo: "globird.png" },
  { keywords: ["origin energy"], logo: "originEnergy.png" },
  { keywords: ["south east water", "southeastwater"], logo: "southeastwater.jpg" },
  { keywords: ["superloop"], logo: "superloop.png" },

  // --- Transport / tolls ---
  { keywords: ["linkt"], logo: "linkt.jpeg" },
  { keywords: ["myki"], logo: "myki.jpeg" },
  { keywords: ["ptv", "public transport victoria"], logo: "ptv.jpeg" },
  { keywords: ["malaysia airlines", "malaysian airlines"], logo: "malaysianairlines.jpeg" },
  { keywords: ["vicroads"], logo: "vicroads.png" },
  { keywords: ["australia post", "auspost", "aupost"], logo: "aupost.png" },

  // --- Insurance / finance ---
  { keywords: ["aami"], logo: "aami.png" },
  { keywords: ["hannover", "real insurance"], logo: "hannover-real-insurance.jpeg" },
  { keywords: ["macquarie", "macquaire"], logo: "macquaire.jpeg" },
  { keywords: ["h&r block", "h & r block", "hrblock"], logo: "hrblock.png" },

  // --- Government / tax ---
  { keywords: ["sro", "state revenue office"], logo: "sro.png" },
  { keywords: ["ato", "australian taxation office"], logo: "ato.png" },

  // --- Leisure ---
  { keywords: ["the lott", "thelott"], logo: "thelott.jpg" },

  // --- Payments / subscriptions / tech ---
  { keywords: ["paypal"], logo: "paypal.png" },
  { keywords: ["apple.com", "apple store", "itunes", "apple"], logo: "apple.jpeg" },
  { keywords: ["microsoft", "msft"], logo: "microsoft.png" },
  { keywords: ["disney plus", "disneyplus", "disney+"], logo: "disneyplus.jpeg" },
  { keywords: ["xbox"], logo: "xbos.png" },
  { keywords: ["amazon prime video", "amazonprimevideo"], logo: "amazonprimevideo.jpg" },

  // --- Other / misc ---
  { keywords: ["schoolpix", "school pix"], logo: "schoolpix.jpeg" },
  { keywords: ["sea life", "sealife"], logo: "sealifeaquarium.jpeg" },

  // --- Banks (kept LAST — a customer's own bank's name shows up in the
  // description of almost every transaction from that account, e.g. real
  // ANZ export lines all start with "ANZ INTERNET BANKING...", so these
  // must only catch transactions that no more specific merchant keyword
  // above already matched, the same reasoning already applied to the
  // generic "amazon" entry vs. its more specific siblings) ---
  { keywords: ["anz internet banking", "anz bank"], logo: "ANZ.png" },
  { keywords: ["nab internet banking", "nab bank"], logo: "NAB.png" },
];

// Compatibility export (old name)
export const merchantLogos = MERCHANT_LOGOS;

// Return the correct logo path (or null)
export function getMerchantLogo(description = "") {
  const text = description.toLowerCase();
  for (const entry of MERCHANT_LOGOS) {
    if (entry.keywords.some(k => text.includes(k))) {
      return `assets/logos/${entry.logo}`;
    }
  }
  return null;
}
