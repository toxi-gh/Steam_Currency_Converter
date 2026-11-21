(() => {
  "use strict";

  const currencies = Object.freeze({
    RUB: {id: 5, symbol: "₽", format: "1000,00 руб.", trim: true},
    KZT: {id: 37, symbol: "₸", format: "1 000,00₸"},
    USD: {id: 1, symbol: "$", format: "$1,000.00"},
    EUR: {id: 3, symbol: "€", format: "1 000,00€"},
    UAH: {id: 18, symbol: "₴", format: "1 000,00₴"},
    GBP: {id: 2, symbol: "£", format: "£1,000.00"},
    BRL: {id: 7, symbol: "R$", format: "R$1.000,00"},
    AUD: {id: 21, symbol: "A$", format: "A$ 1,000.00"},
    CAD: {id: 20, symbol: "C$", format: "C$ 1,000.00"},
    JPY: {id: 8, symbol: "¥", format: "¥1,000.00", digits: 0},
    KRW: {id: 16, symbol: "₩", format: "₩ 1,000.00", digits: 0},
    SGD: {id: 13, symbol: "S$", format: "S$1,000.00"},
    CNY: {id: 23, symbol: "¥", format: "¥1,000.00"},
    INR: {id: 24, symbol: "₹", format: "₹1,000.00"},
    ILS: {id: 35, symbol: "₪", format: "₪1,000.00"},
    CHF: {id: 4, symbol: "CHF", format: "CHF 1 000.00"},
    PLN: {id: 6, symbol: "zł", format: "1 000,00 zł"},
    NOK: {id: 9, symbol: "kr", format: "1.000,00 kr"},
    IDR: {id: 10, symbol: "Rp", format: "Rp 1 000.00", digits: 0},
    MYR: {id: 11, symbol: "RM", format: "RM1,000.00"},
    PHP: {id: 12, symbol: "₱", format: "₱1,000.00"},
    THB: {id: 14, symbol: "฿", format: "฿1,000.00"},
    VND: {id: 15, symbol: "₫", format: "1.000,00₫", digits: 0},
    MXN: {id: 19, symbol: "Mex$", format: "Mex$ 1,000.00"},
    NZD: {id: 22, symbol: "NZ$", format: "NZ$ 1,000.00"},
    CLP: {id: 25, symbol: "CLP$", format: "CLP$1.000,00", digits: 0},
    PEN: {id: 26, symbol: "S/.", format: "S/. 1,000.00"},
    COP: {id: 27, symbol: "COL$", format: "COL$ 1.000,00"},
    ZAR: {id: 28, symbol: "R", format: "R 1 000.00"},
    HKD: {id: 29, symbol: "HK$", format: "HK$ 1,000.00"},
    TWD: {id: 30, symbol: "NT$", format: "NT$ 1,000.00"},
    SAR: {id: 31, symbol: "SR", format: "1,000.00 SR"},
    AED: {id: 32, symbol: "AED", format: "1,000.00 AED"},
    KWD: {id: 38, symbol: "KD", format: "1,000.00 KD"},
    QAR: {id: 39, symbol: "QR", format: "1,000.00 QR"},
    CRC: {id: 40, symbol: "₡", format: "₡1.000,00"},
    UYU: {id: 41, symbol: "$U", format: "$U1.000,00"}
  });

  const styles = new Map(Object.entries(currencies).map(([code, data]) => {
    const [, before, group, decimal, after] = /^(\D*)1(\D?)000(\D)00(\D*)$/.exec(data.format);
    const space = text => text.replace(/ /g, " ");
    return [code, Object.freeze({before: space(before), after: space(after), group: space(group), decimal, digits: data.digits ?? 2, trim: Boolean(data.trim), sign: (before + after).trim()})];
  }));

  const languages = Object.freeze({
    en: "English",
    ru: "Русский",
    "zh-CN": "简体中文",
    es: "Español",
    "pt-BR": "Português (Brasil)",
    ja: "日本語",
    de: "Deutsch",
    pl: "Polski",
    fr: "Français",
    ko: "한국어"
  });

  const locales = Object.freeze({en: "en-US", ru: "ru-RU", "zh-CN": "zh-CN", es: "es-ES", "pt-BR": "pt-BR", ja: "ja-JP", de: "de-DE", pl: "pl-PL", fr: "fr-FR", ko: "ko-KR"});

  const languageCurrencies = Object.freeze({en: "USD", ru: "RUB", "zh-CN": "CNY", es: "EUR", "pt-BR": "BRL", ja: "JPY", de: "EUR", pl: "PLN", fr: "EUR", ko: "KRW"});

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
    calcCurrencies: Object.freeze(["USD", "EUR", "KZT", "CNY", "UAH"]),
    termsAccepted: false,
    promptMuted: false
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
      calcCurrencies: list.filter(code => code === target || ++extras <= calcLimit),
      termsAccepted: value.termsAccepted === true,
      promptMuted: value.promptMuted === true
    };
  }

  const releasesUrl = "https://github.com/toxi-gh/Steam_Currency_Converter/releases";

  function parseVersion(value) {
    const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(value ?? ""));
    return match ? [match[1], match[2], match[3] || "0"].map(Number).join(".") : "";
  }

  function compareVersions(left, right) {
    const a = parseVersion(left).split(".").map(Number);
    const b = parseVersion(right).split(".").map(Number);
    if (!parseVersion(left) || !parseVersion(right)) return parseVersion(left) ? 1 : parseVersion(right) ? -1 : 0;
    for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
    return 0;
  }

  function updateStatus(info, current) {
    const latest = parseVersion(info?.latest);
    const skipped = parseVersion(info?.skipped);
    const available = Boolean(latest) && compareVersions(latest, current) > 0;
    return {available, latest, current: parseVersion(current), notify: available && (!skipped || compareVersions(latest, skipped) > 0)};
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

  function composeMoney(value, currency, options) {
    const style = styles.get(currency);
    const [integer, fraction] = new Intl.NumberFormat("en-US", {...options, useGrouping: false}).format(value).split(".");
    const grouped = style.group ? integer.replace(/\B(?=(\d{3})+$)/g, style.group) : integer;
    return `${style.before}${fraction ? `${grouped}${style.decimal}${fraction}` : grouped}${style.after}`;
  }

  function moneyDigits(amount, currency, precision) {
    const style = styles.get(currency);
    if (precision !== "auto") return Number(precision);
    if (style.trim && Number.isInteger(Math.round(amount * 10 ** style.digits) / 10 ** style.digits)) return 0;
    return style.digits;
  }

  function formatMoney(amount, currency, settings) {
    const digits = moneyDigits(amount, currency, settings.precision);
    return composeMoney(amount, currency, {minimumFractionDigits: digits, maximumFractionDigits: digits});
  }

  function formatRateAmount(rate, currency, digits = 10) {
    return composeMoney(rate, currency, {maximumSignificantDigits: digits});
  }

  function currencySign(currency) {
    return styles.get(currency).sign;
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

  globalThis.SteamFX = Object.freeze({releasesUrl, parseVersion, updateStatus, currencies, languages, setupSteps, defaults, isCurrency, currencyFor, localeOf, currencyName, displayMode, displayPatch, currencyFromValue, normalizeSettings, positiveRate, pairKey, validTimestamp, resolvePair, resolveRate, calcLimit, formatMoney, formatRateAmount, currencySign, dualSeparator, dualOriginal, joinDual, tooltipsActive});
})();
