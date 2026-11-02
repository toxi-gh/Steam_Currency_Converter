"use strict";

const $ = id => document.getElementById(id);
let state = {settings: SteamFX.normalizeSettings(), rateCache: {entries: {}}, rateFailures: {}};
let loading = false;
let loadVersion = 0;
const pendingSettings = new Map();
let settingsEdit = 0;
let settingsEvents = 0;
let settingsLoaded = false;
let cacheRevision = 0;
let statsLoading = false;
let pageStats = null;
let storageError = false;
const popupContent = document.querySelector("main");
let resizeFrame = 0;
let popupReady = false;
const root = document.documentElement;
let liveAccent = null;
let themeReady = false;
let commitTimer = 0;
let dragging = false;
const picker = {h: 0, x: 0, y: 0, width: 1, height: 1};
const clamp = value => Math.min(1, Math.max(0, value));

try {
  const cached = JSON.parse(localStorage.getItem("popupTheme") || "null");
  if (cached && typeof cached === "object") {
    SteamFXTheme.apply(root, cached.accent);
    document.body.classList.toggle("glow-off", cached.enabled === false);
  }
} catch {}

function resizePopup() {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    const height = Math.ceil(popupContent.getBoundingClientRect().height);
    if (!height) return;
    const value = `${height}px`;
    if (document.body.style.height !== value) document.body.style.height = value;
    if (!popupReady) {
      popupReady = true;
      requestAnimationFrame(() => document.body.classList.add("popup-ready"));
    }
  });
}

if (typeof ResizeObserver === "function") new ResizeObserver(resizePopup).observe(popupContent);
document.fonts?.ready.then(resizePopup);
document.fonts?.addEventListener("loadingdone", resizePopup);

function t(key, values) {
  return SteamFXI18n.translate(state.settings.language, key, values);
}

function populateSelect(element, codes, value) {
  if (element.options.length !== codes.length || codes.some((code, index) => element.options[index].value !== code)) element.replaceChildren(...codes.map(code => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = `${code} ${SteamFX.currencies[code].symbol}`;
    option.title = SteamFX.currencies[code][state.settings.language];
    return option;
  }));
  for (const option of element.options) option.title = SteamFX.currencies[option.value][state.settings.language];
  element.value = value;
}

function optimisticSettings(settings) {
  return SteamFX.normalizeSettings({...settings, ...Object.fromEntries([...pendingSettings].map(([key, entry]) => [key, entry.value]))});
}

function providerDate(rate, language) {
  if (rate.source !== "playwallet") return rate.providerUpdatedAt;
  const raw = rate.providerUpdatedAt.slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00Z`) : null;
  if (!date || !Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", {day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC"}).format(date);
}

function renderUI() {
  const settings = state.settings;
  document.documentElement.lang = settings.language;
  for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll("[data-i18n-aria]")) element.setAttribute("aria-label", t(element.dataset.i18nAria));
  for (const element of document.querySelectorAll("[data-i18n-title]")) element.title = t(element.dataset.i18nTitle);
  $("language-ru").setAttribute("aria-pressed", String(settings.language === "ru"));
  $("language-en").setAttribute("aria-pressed", String(settings.language === "en"));
  $("enabled").checked = settings.enabled;
  $("manual-enabled").checked = settings.manualEnabled;
  $("dual-prices").checked = settings.dualPrices;
  $("dual-prices").closest(".dual-block").classList.toggle("on", settings.dualPrices);
  $("tooltips").checked = settings.tooltips && !settings.dualPrices;
  $("tooltips").disabled = settings.dualPrices;
  $("tooltips-row").classList.toggle("locked", settings.dualPrices);
  $("tooltips-hint").textContent = t(settings.dualPrices ? "tooltipsOff" : "tooltipsHint");
  $("manual-fields").hidden = !settings.manualEnabled;
  $("manual-unit").textContent = t("manualUnit", {source: settings.manualSourceCurrency, target: settings.targetCurrency});
  $("manual-only").textContent = t("manualOnly", {source: settings.manualSourceCurrency, target: settings.targetCurrency});
  $("manual-target").textContent = settings.targetCurrency;
  if ((document.activeElement !== $("manual-rate") || !pendingSettings.has("manualRate")) && $("manual-rate").value !== settings.manualRate) $("manual-rate").value = settings.manualRate;
  const codes = Object.keys(SteamFX.currencies);
  populateSelect($("source-currency"), codes, settings.manualSourceCurrency);
  populateSelect($("target-currency"), codes, settings.targetCurrency);
  for (const button of document.querySelectorAll("[data-precision]")) {
    const active = button.dataset.precision === settings.precision;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  const accent = renderTheme();
  if (settingsLoaded) {
    try {
      localStorage.setItem("popupTheme", JSON.stringify({accent: state.settings.accentColor, enabled: settings.enabled}));
    } catch {}
    if (!themeReady) {
      themeReady = true;
      requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("theme-ready")));
    }
  }
  if (!$("color-picker").hidden && !liveAccent && document.activeElement !== $("hex-input")) $("hex-input").value = accent.toUpperCase();
  renderRate();
  renderStats();
}

function renderTheme() {
  const accent = SteamFXTheme.apply(root, liveAccent || state.settings.accentColor);
  let preset = false;
  for (const button of $("swatches").children) {
    const active = button.dataset.color === accent;
    if (active) preset = true;
    button.setAttribute("aria-pressed", String(active));
  }
  $("custom-color").classList.toggle("active", !preset);
  document.body.classList.toggle("glow-off", !state.settings.enabled);
  return accent;
}

function buildSwatches() {
  for (const preset of SteamFXTheme.presets) {
    const button = document.createElement("button");
    const key = `color${preset.id[0].toUpperCase()}${preset.id.slice(1)}`;
    button.type = "button";
    button.className = "swatch";
    button.dataset.color = preset.color;
    button.dataset.i18nTitle = key;
    button.dataset.i18nAria = key;
    button.style.setProperty("--swatch", preset.color);
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#check-icon");
    icon.append(use);
    button.append(icon);
    button.addEventListener("click", () => selectAccent(preset.color));
    $("swatches").append(button);
  }
}

function selectAccent(color) {
  clearTimeout(commitTimer);
  commitTimer = 0;
  liveAccent = null;
  if (!$("color-picker").hidden) {
    pickerFromHex(color);
    $("picker-note").hidden = true;
    renderPicker();
  }
  change({accentColor: color});
}

function previewAccent(color) {
  liveAccent = color;
  renderTheme();
}

function commitAccent() {
  clearTimeout(commitTimer);
  commitTimer = 0;
  if (!liveAccent) return;
  const color = liveAccent;
  liveAccent = null;
  if (color !== state.settings.accentColor) change({accentColor: color});
  else renderTheme();
}

function scheduleCommit() {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(commitAccent, 200);
}

function pickerFromHex(hex) {
  const [hue, saturation, value] = SteamFXTheme.rgbToHsv(SteamFXTheme.toRgb(hex));
  if (saturation > 0 && value > 0) picker.h = hue;
  [picker.x, picker.y] = SteamFXTheme.project(picker.h, saturation, SteamFXTheme.yAt(value), picker.width, picker.height);
  drawMask();
}

function drawMask() {
  const {width, height} = picker;
  const points = SteamFXTheme.boundary(picker.h, 72).map(([x, y]) => [x * width, Math.min(1, Math.max(0, y)) * height]);
  const fill = $("sv-mask-fill");
  const line = $("sv-mask-line");
  if (points.every(([, y]) => y >= height - 0.5)) {
    fill.setAttribute("d", "");
    line.setAttribute("d", "");
    return;
  }
  const curve = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  fill.setAttribute("d", `${curve}L${width} ${height}L0 ${height}Z`);
  let path = "";
  let drawing = false;
  for (const [x, y] of points) {
    const inside = y < height - 0.5 && y > 0.5;
    if (inside) path += `${drawing ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    drawing = inside;
  }
  line.setAttribute("d", path);
}

function pickerState() {
  const [x, y] = SteamFXTheme.project(picker.h, picker.x, picker.y, picker.width, picker.height);
  return {x, y, color: SteamFXTheme.colorAt(picker.h, x, y)};
}

function renderPicker(syncInput = true) {
  const {x, y, color} = pickerState();
  const value = 1 - y * (1 - SteamFXTheme.valueFloor);
  $("color-picker").style.setProperty("--picker-hue", picker.h.toFixed(1));
  $("sv-thumb").style.left = `${x * 100}%`;
  $("sv-thumb").style.top = `${y * 100}%`;
  $("sv-area").setAttribute("aria-valuenow", String(Math.round(x * 100)));
  $("sv-area").setAttribute("aria-valuetext", t("svValue", {s: Math.round(x * 100), v: Math.round(value * 100)}));
  $("hue").value = String(Math.round(picker.h) % 360);
  if (syncInput) {
    $("hex-input").value = color.toUpperCase();
    $("hex-input").setAttribute("aria-invalid", "false");
  }
  return color;
}

function moveSv(x, y) {
  [picker.x, picker.y] = SteamFXTheme.project(picker.h, clamp(x), clamp(y), picker.width, picker.height);
  $("picker-note").hidden = true;
  previewAccent(renderPicker());
}

function svFromPointer(event) {
  const rect = $("sv-area").getBoundingClientRect();
  moveSv((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
}

function endDrag() {
  if (!dragging) return;
  dragging = false;
  commitAccent();
}

function commitHex() {
  const typed = SteamFXTheme.parseHex($("hex-input").value);
  if (!typed) {
    $("picker-note").hidden = true;
    renderPicker();
    commitAccent();
    return;
  }
  pickerFromHex(typed);
  const color = renderPicker();
  $("picker-note").hidden = color === typed;
  previewAccent(color);
  commitAccent();
}

function openPicker(focus) {
  $("color-picker").hidden = false;
  $("custom-color").setAttribute("aria-expanded", "true");
  picker.width = $("sv-area").clientWidth || 1;
  picker.height = $("sv-area").clientHeight || 1;
  $("sv-mask").setAttribute("viewBox", `0 0 ${picker.width} ${picker.height}`);
  $("sv-mask").setAttribute("preserveAspectRatio", "none");
  $("picker-note").hidden = true;
  pickerFromHex(liveAccent || state.settings.accentColor);
  renderPicker();
  if (focus) $("sv-area").focus();
}

function closePicker(restoreFocus) {
  if ($("color-picker").hidden) return;
  dragging = false;
  commitAccent();
  $("color-picker").hidden = true;
  $("custom-color").setAttribute("aria-expanded", "false");
  if (restoreFocus) $("custom-color").focus();
}

function renderRate() {
  const settings = state.settings;
  const rate = SteamFX.resolveRate(state, settings.manualSourceCurrency);
  const playwallet = rate?.source === "playwallet";
  const provider = t(playwallet ? "playwallet" : "steamCurrency");
  const sourceLink = document.querySelector(".source-link");
  sourceLink.href = playwallet ? "https://playwallet.bot/steam-currency" : "https://steam-currency.ru/";
  sourceLink.querySelector("strong").textContent = playwallet ? "playwallet.bot" : "steam-currency.ru";
  sourceLink.hidden = !["widget", "table", "playwallet"].includes(rate?.source);
  $("source-card").hidden = sourceLink.hidden;
  const key = SteamFX.pairKey(settings.manualSourceCurrency, settings.targetCurrency);
  const failure = state.rateFailures[key];
  const manualInvalid = settings.manualEnabled && settings.manualSourceCurrency !== settings.targetCurrency && !SteamFX.positiveRate(settings.manualRate);
  $("manual-validation").hidden = !manualInvalid;
  $("manual-rate").setAttribute("aria-invalid", String(manualInvalid));
  $("unit-value").textContent = `1 ${SteamFX.currencies[settings.manualSourceCurrency].symbol}`;
  const rateValue = $("rate-value");
  rateValue.textContent = rate ? `${SteamFX.formatRate(rate.rate, settings.language)} ${SteamFX.currencies[settings.targetCurrency].symbol}` : "—";
  rateValue.parentElement.dataset.size = rateValue.textContent.length > 18 ? "small" : rateValue.textContent.length > 11 ? "medium" : "large";
  const badge = $("mode-badge");
  badge.classList.toggle("manual", settings.manualEnabled);
  badge.classList.toggle("stale", Boolean(rate?.stale));
  badge.querySelector("b").textContent = t(settings.manualEnabled ? "manual" : rate?.stale ? "stale" : "automatic");
  $("refresh").disabled = loading || settings.manualEnabled || !settings.enabled || settings.manualSourceCurrency === settings.targetCurrency;
  $("refresh").classList.toggle("loading", loading);
  $("provider-date").textContent = "";
  if (loading) $("rate-status").textContent = t("fetching");
  else if (!settings.enabled) $("rate-status").textContent = t("paused");
  else if (settings.manualEnabled) $("rate-status").textContent = t(manualInvalid ? "noRate" : "manual");
  else if (rate?.fetchedAt) {
    const time = new Intl.DateTimeFormat(settings.language === "ru" ? "ru-RU" : "en-US", {day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"}).format(rate.fetchedAt);
    $("rate-status").textContent = t("cached", {time});
    const date = providerDate(rate, settings.language);
    $("provider-date").textContent = date ? `${provider} · ${t("providerDate", {date})}` : provider;
  } else $("rate-status").textContent = t(rate ? "automatic" : "unavailable");
  let error = "";
  if (storageError) error = t("storageError");
  else if (!settings.manualEnabled && settings.enabled && rate?.stale) error = t("staleHint");
  else if (!settings.manualEnabled && settings.enabled && !rate && failure) error = t(failure.code === "PAIR_UNAVAILABLE" ? "pairError" : failure.code === "FORMAT" ? "formatError" : "networkError");
  $("error").hidden = !error;
  $("error").textContent = error;
  renderDualPreview();
  renderCalculator();
}

function renderDualPreview() {
  const settings = state.settings;
  const source = settings.manualSourceCurrency;
  const rate = source === settings.targetCurrency ? null : SteamFX.resolveRate(state, source);
  const sample = {...settings, precision: "0"};
  const original = amount => `${SteamFX.dualOriginal(SteamFX.formatMoney(amount, source, sample))}${SteamFX.dualSeparator}`;
  const converted = amount => rate ? SteamFX.formatMoney(amount * rate.rate, settings.targetCurrency, settings) : "—";
  $("dual-plain-original").textContent = original(1000);
  $("dual-plain-converted").textContent = converted(1000);
  $("dual-old-converted").textContent = converted(2000);
  $("dual-sale-original").textContent = original(1000);
  $("dual-sale-converted").textContent = converted(1000);
}

function renderCalculator() {
  const source = state.settings.manualSourceCurrency;
  $("calculator-source").textContent = source;
  const amount = SteamFXPrices.parseAmount($("calculator-amount").value);
  const rate = SteamFX.resolveRate(state, source);
  $("calculator-result").textContent = amount !== null && rate ? SteamFX.formatMoney(amount * rate.rate, state.settings.targetCurrency, state.settings) : "—";
  $("calculator-amount").setAttribute("aria-invalid", String(amount === null));
  resizePopup();
}

function renderStats() {
  $("page-stats").textContent = !state.settings.enabled ? t("paused") : pageStats ? t("converted", {count: pageStats.count}) : t("openSteam");
  document.querySelector(".page-status").classList.toggle("active", Boolean(state.settings.enabled && pageStats?.count));
  resizePopup();
}

async function persist(patch) {
  const edit = ++settingsEdit;
  for (const [key, value] of Object.entries(patch)) pendingSettings.set(key, {value, edit});
  try {
    const response = await chrome.runtime.sendMessage({type: "UPDATE_SETTINGS", patch});
    if (!response?.ok) throw new Error("STORAGE");
    for (const key of Object.keys(patch)) if (pendingSettings.get(key)?.edit === edit) pendingSettings.delete(key);
    const revision = settingsEvents;
    const stored = await chrome.storage.local.get("settings");
    state.settings = optimisticSettings(revision === settingsEvents ? stored.settings : state.settings);
    settingsLoaded = true;
    storageError = false;
    renderUI();
    return true;
  } catch {
    for (const key of Object.keys(patch)) if (pendingSettings.get(key)?.edit === edit) pendingSettings.delete(key);
    storageError = true;
    renderRate();
    return false;
  }
}

function change(patch, refresh = false) {
  if (patch.targetCurrency && patch.targetCurrency !== state.settings.targetCurrency || patch.manualSourceCurrency && patch.manualSourceCurrency !== state.settings.manualSourceCurrency) patch = {...patch, manualRate: ""};
  state.settings = SteamFX.normalizeSettings({...state.settings, ...patch});
  patch = Object.fromEntries(Object.keys(patch).map(key => [key, state.settings[key]]));
  renderUI();
  persist(patch).then(saved => {
    if (!saved) return;
    if (refresh) loadState();
    readPageStats();
  });
}

async function loadState(force = false) {
  const version = ++loadVersion;
  const revision = cacheRevision;
  loading = true;
  renderRate();
  try {
    const response = await chrome.runtime.sendMessage({type: force ? "REFRESH_RATES" : "GET_STATE", sources: [state.settings.manualSourceCurrency]});
    if (version !== loadVersion) return;
    if (!response?.ok) throw new Error("STORAGE");
    if (revision === cacheRevision) {
      state.rateCache = response.state.rateCache || {entries: {}};
      state.rateFailures = response.state.rateFailures || {};
    }
    storageError = false;
  } catch {
    if (version === loadVersion) storageError = true;
  } finally {
    if (version === loadVersion) {
      loading = false;
      renderRate();
    }
  }
}

async function readPageStats() {
  if (statsLoading) return;
  statsLoading = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    pageStats = tab?.id ? await chrome.tabs.sendMessage(tab.id, {type: "PAGE_STATS"}) : null;
  } catch {
    pageStats = null;
  } finally {
    statsLoading = false;
  }
  renderStats();
}

function selectTab(name) {
  if (!["prices", "settings"].includes(name)) return;
  closePicker(false);
  for (const tab of ["prices", "settings"]) {
    const selected = name === tab;
    $(`${tab}-panel`).hidden = !selected;
    $(`${tab}-tab`).classList.toggle("active", selected);
    $(`${tab}-tab`).setAttribute("aria-selected", String(selected));
    $(`${tab}-tab`).tabIndex = selected ? 0 : -1;
  }
  resizePopup();
}

$("language-ru").addEventListener("click", () => change({language: "ru"}));
$("language-en").addEventListener("click", () => change({language: "en"}));
$("enabled").addEventListener("change", event => change({enabled: event.target.checked}, true));
$("manual-enabled").addEventListener("change", event => change({manualEnabled: event.target.checked}, true));
$("source-currency").addEventListener("change", event => change({manualSourceCurrency: event.target.value}, true));
$("target-currency").addEventListener("change", event => change({targetCurrency: event.target.value}, true));
$("tooltips").addEventListener("change", event => change({tooltips: event.target.checked}));
$("dual-prices").addEventListener("change", event => change({dualPrices: event.target.checked}));
$("refresh").addEventListener("click", () => loadState(true));
$("manual-rate").addEventListener("input", event => {
  change({manualRate: event.target.value});
});
$("calculator-amount").addEventListener("input", renderCalculator);
for (const button of document.querySelectorAll("[data-precision]")) button.addEventListener("click", () => change({precision: button.dataset.precision}));
for (const name of ["prices", "settings"]) $(`${name}-tab`).addEventListener("click", () => selectTab(name));
$("custom-color").addEventListener("click", event => {
  if ($("color-picker").hidden) openPicker(event.detail === 0);
  else closePicker(false);
});
$("picker-done").addEventListener("click", () => closePicker(true));
$("sv-area").addEventListener("pointerdown", event => {
  if (event.button !== 0) return;
  event.preventDefault();
  $("sv-area").focus();
  $("sv-area").setPointerCapture(event.pointerId);
  dragging = true;
  svFromPointer(event);
});
$("sv-area").addEventListener("pointermove", event => {
  if (dragging) svFromPointer(event);
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) $("sv-area").addEventListener(type, endDrag);
$("sv-area").addEventListener("keydown", event => {
  const step = event.shiftKey ? 0.1 : 0.01;
  const moves = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]};
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  const {x, y} = pickerState();
  moveSv(x + move[0], y + move[1]);
  scheduleCommit();
});
$("hue").addEventListener("input", event => {
  picker.h = Number(event.target.value);
  $("picker-note").hidden = true;
  drawMask();
  previewAccent(renderPicker());
});
$("hue").addEventListener("change", commitAccent);
$("hex-input").addEventListener("input", event => {
  const text = event.target.value.trim().replace(/^#/, "");
  const typed = text.length === 6 ? SteamFXTheme.parseHex(text) : null;
  event.target.setAttribute("aria-invalid", String(/[^0-9a-f]/i.test(text)));
  if (!typed) return;
  pickerFromHex(typed);
  const color = renderPicker(false);
  $("picker-note").hidden = color === typed;
  previewAccent(color);
});
$("hex-input").addEventListener("change", commitHex);
$("hex-input").addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  commitHex();
});
document.addEventListener("pointerdown", event => {
  if ($("color-picker").hidden || $("color-picker").contains(event.target) || $("custom-color").contains(event.target)) return;
  closePicker(false);
}, true);
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || $("color-picker").hidden) return;
  event.preventDefault();
  closePicker(true);
});
addEventListener("pagehide", commitAccent);
document.querySelector(".tabs").addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const next = $("prices-panel").hidden ? "prices" : "settings";
  selectTab(next);
  $(`${next}-tab`).focus();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    settingsEvents++;
    settingsLoaded = true;
    state.settings = optimisticSettings(changes.settings.newValue);
  }
  if (changes.rateCache || changes.rateFailures) cacheRevision++;
  if (changes.rateCache) state.rateCache = changes.rateCache.newValue || {entries: {}};
  if (changes.rateFailures) state.rateFailures = changes.rateFailures.newValue || {};
  if (changes.settings) renderUI();
  else if (changes.rateCache || changes.rateFailures) renderRate();
});

buildSwatches();
selectTab("prices");
chrome.storage.local.get(["settings", "rateCache", "rateFailures"]).then(stored => {
  if (!settingsLoaded) state.settings = optimisticSettings(stored.settings);
  if (!cacheRevision) {
    state.rateCache = stored.rateCache || {entries: {}};
    state.rateFailures = stored.rateFailures || {};
  }
  settingsLoaded = true;
  renderUI();
  loadState();
  readPageStats();
}).catch(() => {
  storageError = true;
  renderUI();
});
setInterval(readPageStats, 700);
