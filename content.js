const DEFAULTS = {
  enabled: true,
  fromCurrency: "KZT",
  toCurrency: "RUB",
  rate: 0.15
};

let settings = Object.assign({}, DEFAULTS);
let storageLoaded = false;
const modifiedNodes = new Map();

const currencySymbols = {
  USD: "$", RUB: "₽", CNY: "¥", JPY: "¥", KRW: "₩",
  SGD: "$", INR: "₹", AUD: "A$", KZT: "₸", UAH: "₴",
  EUR: "€", CAD: "C$", GBP: "£", ILS: "₪", BRL: "R$"
};

function escapeRegExp(str) {
  return str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function loadSettingsAndStart() {
  chrome.storage.sync.get(DEFAULTS, (data) => {
    settings = Object.assign({}, DEFAULTS, data);
    storageLoaded = true;
    if (settings.enabled) convertPrices();
  });
}

function restoreAll() {
  for (const [node, original] of modifiedNodes.entries()) {
    try { node.textContent = original; } catch {}
  }
  modifiedNodes.clear();
}

function tryConvertTextNode(node) {
  if (!node || !node.textContent) return;
  const fromSym = currencySymbols[settings.fromCurrency] || settings.fromCurrency;
  const toSym = currencySymbols[settings.toCurrency] || settings.toCurrency;
  if (!node.textContent.includes(fromSym)) return;

  const esc = escapeRegExp(fromSym);
  const re = new RegExp(
    '(?:' + esc + '\\s*([\\d\\s]+(?:[.,]\\d{1,2})?)' +
    '|' + '([\\d\\s]+(?:[.,]\\d{1,2})?)\\s*' + esc + ')', 'g'
  );

  const original = node.textContent;
  const newText = original.replace(re, (match, g1, g2) => {
    const numStr = (g1 || g2);
    if (!numStr) return match;
    const normalized = numStr.replace(/\s/g, "").replace(",", ".");
    const value = parseFloat(normalized);
    if (isNaN(value) || !settings.enabled) return match;

    const converted = value * settings.rate;
    const hasFraction = Math.abs(converted % 1) > 1e-9;
    const opts = { maximumFractionDigits: 2, minimumFractionDigits: hasFraction ? 2 : 0 };
    const formatted = converted.toLocaleString('ru-RU', opts);
    return " " + formatted + (toSym || '');
  });

  if (newText !== original) {
    if (!modifiedNodes.has(node)) modifiedNodes.set(node, original);
    node.textContent = newText;
  }
}

function convertPrices() {
  if (!storageLoaded || !settings.enabled) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while ((node = walker.nextNode())) tryConvertTextNode(node);
}

const observer = new MutationObserver((mutations) => {
  if (!storageLoaded || !settings.enabled) return;
  for (const mut of mutations) {
    for (const added of mut.addedNodes) {
      if (added.nodeType === Node.TEXT_NODE) {
        tryConvertTextNode(added);
      } else if (added.nodeType === Node.ELEMENT_NODE) {
        const walker = document.createTreeWalker(added, NodeFilter.SHOW_TEXT, null, false);
        let n; while ((n = walker.nextNode())) tryConvertTextNode(n);
      }
    }
    if (mut.type === "characterData" && mut.target.nodeType === Node.TEXT_NODE) {
      tryConvertTextNode(mut.target);
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  chrome.storage.sync.get(DEFAULTS, (data) => {
    const prevEnabled = settings.enabled;
    const prevFrom = settings.fromCurrency;
    settings = Object.assign({}, DEFAULTS, data);
    if (!settings.enabled || prevFrom !== settings.fromCurrency || prevEnabled !== settings.enabled) {
      restoreAll();
    }
    if (settings.enabled) convertPrices();
  });
});

window.addEventListener("load", () => {
  loadSettingsAndStart();
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  setTimeout(() => { if (storageLoaded && settings.enabled) convertPrices(); }, 500);
});