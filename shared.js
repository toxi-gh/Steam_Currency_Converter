(() => {
  "use strict";

  const currencies = Object.freeze({
    RUB: {id: 5, symbol: "₽", ru: "Российский рубль", en: "Russian ruble"},
    KZT: {id: 37, symbol: "₸", ru: "Казахстанский тенге", en: "Kazakhstani tenge"},
    USD: {id: 1, symbol: "$", ru: "Доллар США", en: "US dollar"},
    EUR: {id: 3, symbol: "€", ru: "Евро", en: "Euro"},
    UAH: {id: 18, symbol: "₴", ru: "Украинская гривна", en: "Ukrainian hryvnia"},
    GBP: {id: 2, symbol: "£", ru: "Британский фунт", en: "British pound"},
    BRL: {id: 7, symbol: "R$", ru: "Бразильский реал", en: "Brazilian real"},
    AUD: {id: 21, symbol: "A$", ru: "Австралийский доллар", en: "Australian dollar"},
    CAD: {id: 20, symbol: "CDN$", ru: "Канадский доллар", en: "Canadian dollar"},
    JPY: {id: 8, symbol: "¥", ru: "Японская иена", en: "Japanese yen"},
    KRW: {id: 16, symbol: "₩", ru: "Южнокорейская вона", en: "South Korean won"},
    SGD: {id: 13, symbol: "S$", ru: "Сингапурский доллар", en: "Singapore dollar"},
    CNY: {id: 23, symbol: "CN¥", ru: "Китайский юань", en: "Chinese yuan"},
    INR: {id: 24, symbol: "₹", ru: "Индийская рупия", en: "Indian rupee"},
    ILS: {id: 35, symbol: "₪", ru: "Израильский шекель", en: "Israeli shekel"},
    CHF: {id: 4, symbol: "CHF", ru: "Швейцарский франк", en: "Swiss franc"},
    PLN: {id: 6, symbol: "zł", ru: "Польский злотый", en: "Polish zloty"},
    NOK: {id: 9, symbol: "kr", ru: "Норвежская крона", en: "Norwegian krone"},
    IDR: {id: 10, symbol: "Rp", ru: "Индонезийская рупия", en: "Indonesian rupiah"},
    MYR: {id: 11, symbol: "RM", ru: "Малайзийский ринггит", en: "Malaysian ringgit"},
    PHP: {id: 12, symbol: "P", ru: "Филиппинское песо", en: "Philippine peso"},
    THB: {id: 14, symbol: "฿", ru: "Тайский бат", en: "Thai baht"},
    VND: {id: 15, symbol: "₫", ru: "Вьетнамский донг", en: "Vietnamese dong"},
    MXN: {id: 19, symbol: "Mex$", ru: "Мексиканское песо", en: "Mexican peso"},
    NZD: {id: 22, symbol: "NZ$", ru: "Новозеландский доллар", en: "New Zealand dollar"},
    CLP: {id: 25, symbol: "CLP$", ru: "Чилийское песо", en: "Chilean peso"},
    PEN: {id: 26, symbol: "S/.", ru: "Перуанский соль", en: "Peruvian sol"},
    COP: {id: 27, symbol: "COL$", ru: "Колумбийское песо", en: "Colombian peso"},
    ZAR: {id: 28, symbol: "R", ru: "Южноафриканский рэнд", en: "South African rand"},
    HKD: {id: 29, symbol: "HK$", ru: "Гонконгский доллар", en: "Hong Kong dollar"},
    TWD: {id: 30, symbol: "NT$", ru: "Новый тайваньский доллар", en: "New Taiwan dollar"},
    SAR: {id: 31, symbol: "SR", ru: "Саудовский риял", en: "Saudi riyal"},
    AED: {id: 32, symbol: "AED", ru: "Дирхам ОАЭ", en: "UAE dirham"},
    KWD: {id: 38, symbol: "KD", ru: "Кувейтский динар", en: "Kuwaiti dinar"},
    QAR: {id: 39, symbol: "QR", ru: "Катарский риял", en: "Qatari riyal"},
    CRC: {id: 40, symbol: "₡", ru: "Костариканский колон", en: "Costa Rican colon"},
    UYU: {id: 41, symbol: "$U", ru: "Уругвайское песо", en: "Uruguayan peso"},
    TRY: {id: 17, symbol: "TL", ru: "Турецкая лира", en: "Turkish lira"},
    ARS: {id: 34, symbol: "ARS$", ru: "Аргентинское песо", en: "Argentine peso"}
  });

  const defaults = Object.freeze({
    enabled: true,
    language: "ru",
    targetCurrency: "RUB",
    manualEnabled: false,
    manualSourceCurrency: "KZT",
    manualRate: "",
    precision: "2",
    tooltips: true,
    dualPrices: true,
    accentColor: "#62eed4"
  });

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
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
      language: value.language === "en" ? "en" : "ru",
      targetCurrency: isCurrency(value.targetCurrency) ? value.targetCurrency : defaults.targetCurrency,
      manualEnabled: typeof value.manualEnabled === "boolean" ? value.manualEnabled : false,
      manualSourceCurrency: isCurrency(value.manualSourceCurrency) ? value.manualSourceCurrency : "KZT",
      manualRate: typeof value.manualRate === "string" || typeof value.manualRate === "number" ? String(value.manualRate).slice(0, 40) : "",
      precision: ["0", "2", "auto"].includes(String(value.precision)) ? String(value.precision) : "2",
      tooltips: typeof value.tooltips === "boolean" ? value.tooltips : true,
      dualPrices: typeof value.dualPrices === "boolean" ? value.dualPrices : defaults.dualPrices,
      accentColor: typeof value.accentColor === "string" && /^#[0-9a-f]{6}$/i.test(value.accentColor) ? value.accentColor.toLowerCase() : defaults.accentColor
    };
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

  function resolveRate(state, source) {
    const settings = state.settings;
    if (source === settings.targetCurrency) return {rate: 1, source: "identity", stale: false};
    if (settings.manualEnabled) {
      const rate = positiveRate(settings.manualRate);
      return source === settings.manualSourceCurrency && rate ? {rate, source: "manual", stale: false} : null;
    }
    const entry = state.rateCache?.entries?.[pairKey(source, settings.targetCurrency)];
    const rate = positiveRate(entry?.rate);
    if (!rate || !validTimestamp(entry.fetchedAt)) return null;
    const failure = state.rateFailures?.[pairKey(source, settings.targetCurrency)];
    const failed = validTimestamp(failure?.at) && failure.at >= entry.fetchedAt;
    return {...entry, rate, providerUpdatedAt: typeof entry.providerUpdatedAt === "string" ? entry.providerUpdatedAt.slice(0, 80) : "", stale: failed || Date.now() - entry.fetchedAt >= 6 * 60 * 60 * 1000};
  }

  function formatMoney(amount, currency, settings) {
    const digits = settings.precision === "auto" ? new Intl.NumberFormat("en", {style: "currency", currency}).resolvedOptions().maximumFractionDigits : Number(settings.precision);
    const number = new Intl.NumberFormat(settings.language === "ru" ? "ru-RU" : "en-US", {
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
    return new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-US", {maximumSignificantDigits: 10}).format(rate);
  }

  globalThis.SteamFX = Object.freeze({currencies, defaults, isCurrency, currencyFromValue, normalizeSettings, positiveRate, pairKey, validTimestamp, resolveRate, formatMoney, formatRate, dualSeparator, dualOriginal, joinDual, tooltipsActive});
})();
