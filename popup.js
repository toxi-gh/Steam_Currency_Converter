const currencies = [
  "USD","RUB","CNY","JPY","KRW","SGD","INR","AUD",
  "KZT","UAH","EUR","CAD","GBP","ILS","BRL"
];

const TRANSLATIONS = {
  ru: {
    title: "Steam Currency Converter",
    labelEnabled: "Включить:",
    labelFrom: "Из валюты:",
    labelTo: "В валюту:",
    labelRate: "Курс:",
    labelLang: "Язык:",
    btnSave: "Сохранить",
    btnReset: "Сброс"
  },
  en: {
    title: "Steam Currency Converter",
    labelEnabled: "Enabled:",
    labelFrom: "From:",
    labelTo: "To:",
    labelRate: "Rate:",
    labelLang: "Language:",
    btnSave: "Save",
    btnReset: "Reset"
  }
};

const DEFAULTS = {
  enabled: true,
  fromCurrency: "KZT",
  toCurrency: "RUB",
  rate: 0.15,
  lang: "ru"
};

function el(id) { return document.getElementById(id); }

function fillSelectWithCurrencies(select, selected) {
  select.innerHTML = "";
  currencies.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    if (c === selected) opt.selected = true;
    select.appendChild(opt);
  });
}

function applyLanguage(lang) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.ru;
  document.querySelectorAll('[data-i18n]').forEach(node => {
    const key = node.getAttribute('data-i18n');
    if (dict[key]) node.textContent = dict[key];
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const enabled = el('enabled');
  const from = el('from');
  const to = el('to');
  const rate = el('rate');
  const lang = el('lang');
  const saveBtn = el('save');
  const resetBtn = el('reset');

  chrome.storage.sync.get(DEFAULTS, (data) => {
    const s = Object.assign({}, DEFAULTS, data);
    enabled.checked = s.enabled;
    fillSelectWithCurrencies(from, s.fromCurrency);
    fillSelectWithCurrencies(to, s.toCurrency);
    rate.value = s.rate;
    lang.value = s.lang || 'ru';
    applyLanguage(s.lang || 'ru');
  });

  enabled.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: enabled.checked });
  });

  lang.addEventListener('change', () => {
    const l = lang.value;
    applyLanguage(l);
    chrome.storage.sync.set({ lang: l });
  });

  saveBtn.addEventListener('click', () => {
    const payload = {
      enabled: enabled.checked,
      fromCurrency: from.value,
      toCurrency: to.value,
      rate: parseFloat(rate.value) || 0,
      lang: lang.value
    };
    chrome.storage.sync.set(payload);
    window.close();
  });

  resetBtn.addEventListener('click', () => {
    if (confirm('Сбросить настройки?')) {
      chrome.storage.sync.set(DEFAULTS, () => location.reload());
    }
  });
});