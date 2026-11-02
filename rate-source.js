(() => {
  "use strict";

  function attribute(tag, name) {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
    return match?.[1] || "";
  }

  function classContent(html, className) {
    const tags = /<(div|span|td)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
    for (const match of html.matchAll(tags)) {
      if (attribute(match[2], "class").split(/\s+/).includes(className)) return match[3].replace(/<[^>]*>/g, "").trim();
    }
    const pattern = new RegExp(`<(?:div|span)\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([^<]*)<\\/`, "i");
    return html.match(pattern)?.[1]?.trim() || "";
  }

  function parseWidget(html, source, target) {
    const title = html.match(/<title\b[^>]*>([^<]*)<\/title>/i)?.[1] || "";
    if (!title.includes(`${source}:${target}`)) throw new Error("FORMAT");
    const raw = classContent(html, "rate").replace(/&(?:nbsp|#160|#xA0);/gi, "").replace(/\s/g, "");
    const rate = SteamFX.positiveRate(raw);
    if (!rate) throw new Error("FORMAT");
    return {rate, providerUpdatedAt: classContent(html, "footer-label"), source: "widget"};
  }

  function parseTable(html) {
    const body = html.match(/<tbody\b[^>]*id=["']rates_table_body["'][^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
    if (!body) throw new Error("FORMAT");
    const rates = {USD: 1};
    const dates = {};
    for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const pair = row[1].match(/data-pair=["']USD:([A-Z]{3})["']/)?.[1];
      if (!SteamFX.currencies[pair]) continue;
      const tag = [...row[1].matchAll(/<td\b[^>]*>/gi)].find(item => attribute(item[0], "class").split(/\s+/).includes("rate-steam"));
      const rate = SteamFX.positiveRate(tag ? attribute(tag[0], "data-raw") : "");
      if (!rate) continue;
      rates[pair] = rate;
      dates[pair] = row[1].match(/\b\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}\b/)?.[0] || "";
    }
    if (Object.keys(rates).length < 2) throw new Error("FORMAT");
    return {rates, dates};
  }

  function parsePlayWallet(payload) {
    if (!Array.isArray(payload) || payload.length > 5000) throw new Error("FORMAT");
    if (!payload.length) throw new Error("PAIR_UNAVAILABLE");
    const pairs = {};
    for (const row of payload) {
      if (!row || typeof row.currency_code !== "string" || typeof row.base_currency_code !== "string") continue;
      const source = row.base_currency_code.toUpperCase();
      const target = row.currency_code.toUpperCase();
      if (!SteamFX.isCurrency(source) || !SteamFX.isCurrency(target) || source === target) continue;
      if (typeof row.exchange_rate !== "number" || !SteamFX.positiveRate(row.exchange_rate)) continue;
      if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(row.date)) continue;
      const timestamp = Date.parse(row.date);
      if (!Number.isFinite(timestamp)) continue;
      const key = SteamFX.pairKey(source, target);
      if (!pairs[key] || timestamp > pairs[key].timestamp) pairs[key] = {rate: row.exchange_rate, providerUpdatedAt: row.date, timestamp};
    }
    if (!Object.keys(pairs).length) throw new Error("FORMAT");
    return {pairs};
  }

  function tablePair(table, source, target) {
    const from = SteamFX.positiveRate(table.rates?.[source]);
    const to = SteamFX.positiveRate(table.rates?.[target]);
    if (!from || !to) throw new Error("PAIR_UNAVAILABLE");
    const sourceDate = table.dates?.[source] || "";
    const targetDate = table.dates?.[target] || "";
    if (source !== "USD" && target !== "USD" && sourceDate.slice(0, 10) !== targetDate.slice(0, 10)) throw new Error("PAIR_UNAVAILABLE");
    const rate = SteamFX.positiveRate(to / from);
    if (!rate) throw new Error("FORMAT");
    return {rate, source: "table", fetchedAt: table.fetchedAt, providerUpdatedAt: targetDate || sourceDate};
  }

  function playWalletPair(snapshot, source, target) {
    const direct = snapshot.pairs?.[SteamFX.pairKey(source, target)];
    if (direct && SteamFX.positiveRate(direct.rate)) return {rate: direct.rate, source: "playwallet", providerUpdatedAt: direct.providerUpdatedAt, fetchedAt: snapshot.fetchedAt};
    const from = source === "USD" ? {rate: 1} : snapshot.pairs?.[SteamFX.pairKey("USD", source)];
    const to = target === "USD" ? {rate: 1} : snapshot.pairs?.[SteamFX.pairKey("USD", target)];
    if (!SteamFX.positiveRate(from?.rate) || !SteamFX.positiveRate(to?.rate)) throw new Error("PAIR_UNAVAILABLE");
    if (from.providerUpdatedAt && to.providerUpdatedAt && from.providerUpdatedAt.slice(0, 10) !== to.providerUpdatedAt.slice(0, 10)) throw new Error("PAIR_UNAVAILABLE");
    const rate = to.rate / from.rate;
    if (!SteamFX.positiveRate(rate)) throw new Error("FORMAT");
    const dated = [from, to].filter(item => item.providerUpdatedAt).sort((a, b) => a.timestamp - b.timestamp);
    return {rate, source: "playwallet", providerUpdatedAt: dated[0]?.providerUpdatedAt || "", fetchedAt: snapshot.fetchedAt};
  }

  globalThis.SteamFXSource = Object.freeze({parseWidget, parseTable, tablePair, parsePlayWallet, playWalletPair});
})();
