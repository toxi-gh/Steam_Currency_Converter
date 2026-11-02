(() => {
  "use strict";

  const aliases = Object.freeze({
    ...Object.fromEntries(Object.entries(SteamFX.currencies).map(([code, data]) => [data.symbol.toUpperCase(), code])),
    "US$": "USD", "U.S.$": "USD", "USD$": "USD", "CAD$": "CAD", "CA$": "CAD", "C$": "CAD",
    "AUD$": "AUD", "AU$": "AUD", "SGD$": "SGD", "NZD$": "NZD", "HKD$": "HKD", "TWD$": "TWD",
    "MXN$": "MXN", "COP$": "COP", "UYU$": "UYU", "CN￥": "CNY", "￥": "JPY", "₱": "PHP",
    "РУБ": "RUB", "РУБ.": "RUB", "Р.": "RUB", "ГРН": "UAH", "ГРН.": "UAH"
  });
  const tokens = [...new Set([...Object.keys(SteamFX.currencies), ...Object.keys(aliases)])]
    .sort((a, b) => b.length - a.length)
    .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const space = "[\\s\\u200e\\u200f\\u061c]";
  const number = "\\d(?:[\\d.,'’ \\u00a0\\u202f]*\\d)?(?:[.,]--)?";
  const expression = new RegExp(`(?<![\\p{L}\\p{N}_.,])(?:(?<prefix>${tokens})${space}*(?:(?<prefixSymbol>${tokens})${space}*)?(?<prefixAmount>${number})|(?<suffixAmount>${number})${space}*(?<suffix>${tokens}))(?:${space}*(?<trailing>${tokens})(?!${space}*\\d))?(?![\\p{L}\\p{N}_]|[.,]\\d)`, "giu");
  const hint = new RegExp(`(?<![\\p{L}_])(?:${tokens})(?![\\p{L}_])`, "iu");

  function parseAmount(value) {
    let text = value.trim().replace(/[.,]--$/, ".00");
    const dot = text.lastIndexOf(".");
    const comma = text.lastIndexOf(",");
    let fraction = "";
    let integer = text;
    const separator = dot > comma ? "." : ",";
    const index = Math.max(dot, comma);
    if (index >= 0) {
      const tail = text.slice(index + 1);
      if (tail.length <= 2 && /^\d{1,2}$/.test(tail)) {
        fraction = tail;
        integer = text.slice(0, index);
        if (integer.includes(separator)) return null;
      } else if (tail.length !== 3) {
        return null;
      }
    }
    if (!/^\d+$/.test(integer)) {
      const groups = integer.split(/[.,'’ \u00a0\u202f]/);
      if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some(part => !/^\d{3}$/.test(part))) return null;
    }
    text = integer.replace(/[.,'’ \u00a0\u202f]/g, "") + (fraction ? `.${fraction}` : "");
    const amount = Number(text);
    return Number.isFinite(amount) && amount >= 0 && amount <= 1e12 ? amount : null;
  }

  function currencyCode(token, context, rawAmount) {
    const upper = token.toUpperCase();
    if (SteamFX.isCurrency(upper)) return upper;
    const pageCurrency = SteamFX.currencyFromValue(context.pageCurrency);
    if (upper === "$") return pageCurrency && SteamFX.currencies[pageCurrency].symbol.includes("$") ? pageCurrency : "USD";
    if (upper === "¥" || upper === "￥") {
      if (["CNY", "JPY"].includes(pageCurrency)) return pageCurrency;
      return /[.,]\d{2}$/.test(rawAmount) ? "CNY" : "JPY";
    }
    return aliases[upper] || null;
  }

  function hasCurrency(text) {
    return hint.test(text);
  }

  function findPrices(text, context = {}) {
    const matches = [];
    const regex = new RegExp(expression.source, expression.flags);
    for (const match of text.matchAll(regex)) {
      const rawAmount = match.groups.prefixAmount || match.groups.suffixAmount;
      const amount = parseAmount(rawAmount);
      const markers = [match.groups.prefix, match.groups.prefixSymbol, match.groups.suffix, match.groups.trailing].filter(Boolean);
      const explicit = [...new Set(markers.map(marker => marker.toUpperCase()).filter(SteamFX.isCurrency))];
      if (explicit.length > 1) continue;
      const extraCode = /^[\s\u200e\u200f\u061c]+([A-Z]{3})(?![\p{L}\p{N}_])/u.exec(text.slice(match.index + match[0].length));
      if (extraCode) continue;
      const currency = explicit[0] || currencyCode(markers[0], context, rawAmount);
      if (amount === null || !SteamFX.isCurrency(currency)) continue;
      const numberStart = match.groups.prefix ? match.index + match[0].indexOf(rawAmount, match.groups.prefix.length) : match.index;
      matches.push({start: match.index, end: match.index + match[0].length, numberStart, amount, currency, original: match[0]});
    }
    return matches;
  }

  function renderParts(parts, replacements) {
    const spans = new Map();
    let offset = 0;
    const rendered = parts.map((part, index) => {
      const start = offset;
      const end = start + part.length;
      offset = end;
      const edits = replacements.filter(item => item.end > start && item.start < end).map(item => ({
        item,
        start: Math.max(0, item.start - start),
        end: Math.min(part.length, item.end - start),
        value: item.numberStart >= start && item.numberStart < end ? item.value : ""
      })).sort((a, b) => a.start - b.start);
      let result = "";
      let cursor = 0;
      for (const edit of edits) {
        result += part.slice(cursor, edit.start);
        if (edit.value) spans.set(edit.item, {part: index, start: result.length, end: result.length + edit.value.length});
        result += edit.value;
        cursor = edit.end;
      }
      return result + part.slice(cursor);
    });
    return {rendered, spans};
  }

  globalThis.SteamFXPrices = Object.freeze({parseAmount, findPrices, renderParts, hasCurrency});
})();
