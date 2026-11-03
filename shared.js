(() => {
  "use strict";

  const currencies = Object.freeze({
    RUB: {id: 5, symbol: "₽"},
    KZT: {id: 37, symbol: "₸"},
    USD: {id: 1, symbol: "$"},
    EUR: {id: 3, symbol: "€"},
    UAH: {id: 18, symbol: "₴"},
    GBP: {id: 2, symbol: "£"},
    BRL: {id: 7, symbol: "R$"},
    AUD: {id: 21, symbol: "A$"},
    CAD: {id: 20, symbol: "CDN$"},
    JPY: {id: 8, symbol: "¥"},
    KRW: {id: 16, symbol: "₩"},
    SGD: {id: 13, symbol: "S$"},
    CNY: {id: 23, symbol: "CN¥"},
    INR: {id: 24, symbol: "₹"},
    ILS: {id: 35, symbol: "₪"},
    CHF: {id: 4, symbol: "CHF"},
    PLN: {id: 6, symbol: "zł"},
    NOK: {id: 9, symbol: "kr"},
    IDR: {id: 10, symbol: "Rp"},
    MYR: {id: 11, symbol: "RM"},
    PHP: {id: 12, symbol: "P"},
    THB: {id: 14, symbol: "฿"},
    VND: {id: 15, symbol: "₫"},
    MXN: {id: 19, symbol: "Mex$"},
    NZD: {id: 22, symbol: "NZ$"},
    CLP: {id: 25, symbol: "CLP$"},
    PEN: {id: 26, symbol: "S/."},
    COP: {id: 27, symbol: "COL$"},
    ZAR: {id: 28, symbol: "R"},
    HKD: {id: 29, symbol: "HK$"},
    TWD: {id: 30, symbol: "NT$"},
    SAR: {id: 31, symbol: "SR"},
    AED: {id: 32, symbol: "AED"},
    KWD: {id: 38, symbol: "KD"},
    QAR: {id: 39, symbol: "QR"},
    CRC: {id: 40, symbol: "₡"},
    UYU: {id: 41, symbol: "$U"}
  });

  const languages = Object.freeze({
    en: "English",
    ru: "Русский",
    "zh-CN": "简体中文",
    es: "Español",
    "pt-BR": "Português (Brasil)",
    ja: "日本語",
    de: "Deutsch",
    pl: "Polski"
  });

  const locales = Object.freeze({en: "en-US", ru: "ru-RU", "zh-CN": "zh-CN", es: "es-ES", "pt-BR": "pt-BR", ja: "ja-JP", de: "de-DE", pl: "pl-PL"});

  const languageCurrencies = Object.freeze({en: "USD", ru: "RUB", "zh-CN": "CNY", es: "EUR", "pt-BR": "BRL", ja: "JPY", de: "EUR", pl: "PLN"});

  function isLanguage(code) {
    return typeof code === "string" && Object.hasOwn(languages, code);
  }

  function detectLanguage() {
    const preferred = typeof navigator === "object" ? [...(navigator.languages || []), navigator.language] : [];
    for (const value of preferred) {
      if (typeof value !== "string" || !value) continue;
      const [base, region] = value.split(/[-_]/);
      const language = base.toLowerCase();
      if (language === "zh") return "zh-CN";
      if (language === "pt") return "pt-BR";
      const exact = `${language}${region ? `-${region.toUpperCase()}` : ""}`;
      if (isLanguage(exact)) return exact;
      if (isLanguage(language)) return language;
    }
    return "en";
  }

  function currencyFor(language) {
    return languageCurrencies[language] || "USD";
  }

  const detectedLanguage = detectLanguage();

  const defaults = Object.freeze({
    enabled: true,
    language: detectedLanguage,
    targetCurrency: currencyFor(detectedLanguage),
    manualEnabled: false,
    manualSourceCurrency: "KZT",
    manualRate: "",
    precision: "2",
    tooltips: true,
    dualPrices: true,
    accentColor: "#62eed4",
    setupDone: false,
    setupStep: 0,
    calcSource: "KZT",
    calcCurrencies: Object.freeze(["USD", "EUR", "KZT", "CNY", "UAH"])
  });

  const calcLimit = 6;

  const setupSteps = 4;

  function isCurrency(code) {
    return typeof code === "string" && Object.hasOwn(currencies, code);
  }

  function currencyFromValue(value) {
    const code = String(value ?? "").trim().toUpperCase();
    if (isCurrency(code)) return code;
    if (["USD_CIS", "USD_LATAM", "USD_MENA", "USD_SASIA"].includes(code)) return "USD";
    if (!/^\d{1,2}$/.test(code)) return null;
    return Object.keys(currencies).find(key => currencies[key].id === Number(code)) || null;
  }

  function normalizeSettings(value = {}) {
    if (!value || typeof value !== "object") value = {};
    const language = isLanguage(value.language) ? value.language : defaults.language;
    const step = Number(value.setupStep);
    const target = isCurrency(value.targetCurrency) ? value.targetCurrency : currencyFor(language);
    const list = Array.isArray(value.calcCurrencies) ? [...new Set(value.calcCurrencies.filter(isCurrency))] : [...defaults.calcCurrencies];
    let extras = 0;
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
      language,
      targetCurrency: target,
      manualEnabled: typeof value.manualEnabled === "boolean" ? value.manualEnabled : false,
      manualSourceCurrency: isCurrency(value.manualSourceCurrency) ? value.manualSourceCurrency : defaults.manualSourceCurrency,
      manualRate: typeof value.manualRate === "string" || typeof value.manualRate === "number" ? String(value.manualRate).slice(0, 40) : "",
      precision: ["0", "2", "auto"].includes(String(value.precision)) ? String(value.precision) : "2",
      tooltips: typeof value.tooltips === "boolean" ? value.tooltips : true,
      dualPrices: typeof value.dualPrices === "boolean" ? value.dualPrices : defaults.dualPrices,
      accentColor: typeof value.accentColor === "string" && /^#[0-9a-f]{6}$/i.test(value.accentColor) ? value.accentColor.toLowerCase() : defaults.accentColor,
      setupDone: typeof value.setupDone === "boolean" ? value.setupDone : Object.keys(value).length > 0,
      setupStep: Number.isInteger(step) && step >= 0 && step < setupSteps ? step : 0,
      calcSource: isCurrency(value.calcSource) ? value.calcSource : defaults.calcSource,
      calcCurrencies: list.filter(code => code === target || ++extras <= calcLimit)
    };
  }

  function localeOf(language) {
    return locales[language] || locales.en;
  }

  const currencyNames = new Map();

  function currencyName(code, language) {
    const locale = localeOf(language);
    try {
      if (!currencyNames.has(locale)) currencyNames.set(locale, new Intl.DisplayNames([locale], {type: "currency"}));
      const name = currencyNames.get(locale).of(code);
      return name ? `${name.charAt(0).toLocaleUpperCase(locale)}${name.slice(1)}` : code;
    } catch {
      return code;
    }
  }

  function displayMode(settings) {
    return settings.dualPrices ? "dual" : settings.tooltips ? "hover" : "converted";
  }

  function displayPatch(mode) {
    if (mode === "dual") return {dualPrices: true};
    return {dualPrices: false, tooltips: mode === "hover"};
  }

  function positiveRate(value) {
    if (typeof value === "number") return Number.isFinite(value) && value > 0 && value <= 1e9 ? value : null;
    const text = String(value ?? "").trim().replace(",", ".");
    if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) && number > 0 && number <= 1e9 ? number : null;
  }

  function pairKey(source, target) {
    return `${source}:${target}`;
  }

  function validTimestamp(value, now = Date.now()) {
    return Number.isFinite(value) && value > 0 && value <= now;
  }

  function resolvePair(state, source, target) {
    const settings = state.settings;
    if (source === target) return {rate: 1, source: "identity", stale: false};
    if (settings.manualEnabled && target === settings.targetCurrency) {
      const rate = positiveRate(settings.manualRate);
      return source === settings.manualSourceCurrency && rate ? {rate, source: "manual", stale: false} : null;
    }
    const entry = state.rateCache?.entries?.[pairKey(source, target)];
    const rate = positiveRate(entry?.rate);
    if (!rate || !validTimestamp(entry.fetchedAt)) return null;
    const failure = state.rateFailures?.[pairKey(source, target)];
    const failed = validTimestamp(failure?.at) && failure.at >= entry.fetchedAt;
    return {...entry, rate, providerUpdatedAt: typeof entry.providerUpdatedAt === "string" ? entry.providerUpdatedAt.slice(0, 80) : "", stale: failed || Date.now() - entry.fetchedAt >= 6 * 60 * 60 * 1000};
  }

  function resolveRate(state, source) {
    return resolvePair(state, source, state.settings.targetCurrency);
  }

  function formatMoney(amount, currency, settings) {
    const digits = settings.precision === "auto" ? new Intl.NumberFormat("en", {style: "currency", currency}).resolvedOptions().maximumFractionDigits : Number(settings.precision);
    const number = new Intl.NumberFormat(localeOf(settings.language), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(amount);
    return `${number}\u00a0${currencies[currency].symbol}`;
  }

  const dualSeparator = "\u00a0· ";

  function dualOriginal(text) {
    return String(text).trim().replace(/\s+/g, "\u00a0");
  }

  function joinDual(original, converted) {
    return `${dualOriginal(original)}${dualSeparator}${converted}`;
  }

  function tooltipsActive(settings) {
    return Boolean(settings.enabled && settings.tooltips && !settings.dualPrices);
  }

  function formatRate(rate, language) {
    return new Intl.NumberFormat(localeOf(language), {maximumSignificantDigits: 10}).format(rate);
  }

  globalThis.SteamFX = Object.freeze({currencies, languages, setupSteps, defaults, isCurrency, isLanguage, currencyFor, localeOf, currencyName, displayMode, displayPatch, currencyFromValue, normalizeSettings, positiveRate, pairKey, validTimestamp, resolvePair, resolveRate, calcLimit, formatMoney, formatRate, dualSeparator, dualOriginal, joinDual, tooltipsActive});
})();
