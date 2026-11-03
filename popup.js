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
const codes = Object.keys(SteamFX.currencies);
const modeKeys = {dual: "modeDual", hover: "modeHover", converted: "modeConverted"};
const svgNamespace = "http://www.w3.org/2000/svg";
let viewReady = false;
let cachedView = null;
const logo = document.querySelector(".brand img");
const logoSource = new Image();
let logoColor = "";
let logoFrame = 0;
const views = ["prices", "calculator", "settings"];
let currentView = "prices";
let viewOpener = null;
let calcLoading = false;
let calcVersion = 0;
let calcEditing = false;
let copiedCode = "";
let copiedTimer = 0;
const calcRows = new Map();
let rowDrag = null;

try {
  const cached = JSON.parse(localStorage.getItem("popupState") || "null");
  if (cached && typeof cached === "object") cachedView = cached;
  localStorage.removeItem("popupTheme");
  const cachedLogo = JSON.parse(localStorage.getItem("popupLogo") || "null");
  if (cachedView && typeof cachedLogo?.src === "string" && cachedLogo.src.startsWith("data:image/png") && cachedLogo.color === SteamFXTheme.ensureReadable(cachedView.accentColor)) {
    logo.src = cachedLogo.src;
    logoColor = cachedLogo.color;
  }
} catch {}
logoSource.src = "icons/128.png";

function resizePopup() {
  if (resizeFrame || !viewReady) return;
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
    return option;
  }));
  for (const option of element.options) option.title = SteamFX.currencyName(option.value, state.settings.language);
  element.value = value;
  element.title = SteamFX.currencyName(value, state.settings.language);
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function icon(name, className) {
  const svg = document.createElementNS(svgNamespace, "svg");
  const use = document.createElementNS(svgNamespace, "use");
  use.setAttribute("href", `#${name}`);
  if (className) svg.setAttribute("class", className);
  svg.append(use);
  return svg;
}

function optimisticSettings(settings) {
  return SteamFX.normalizeSettings({...settings, ...Object.fromEntries([...pendingSettings].map(([key, entry]) => [key, entry.value]))});
}

function renderUI() {
  const settings = state.settings;
  document.documentElement.lang = settings.language;
  for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll("[data-i18n-aria]")) element.setAttribute("aria-label", t(element.dataset.i18nAria));
  for (const element of document.querySelectorAll("[data-i18n-title]")) element.title = t(element.dataset.i18nTitle);
  const inSetup = !settings.setupDone;
  if (!$("setup").hidden && !inSetup) showView("prices");
  $("setup").hidden = !inSetup;
  $("app").hidden = inSetup;
  document.body.classList.toggle("in-setup", inSetup);
  $("language-select").value = settings.language;
  $("enabled").checked = settings.enabled;
  $("power-state").textContent = t(settings.enabled ? "stateOn" : "stateOff");
  $("enabled-switch").classList.toggle("on", settings.enabled);
  $("manual-enabled").checked = settings.manualEnabled;
  const mode = SteamFX.displayMode(settings);
  for (const button of document.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  $("manual-fields").hidden = !settings.manualEnabled;
  $("manual-unit").textContent = t("manualUnit", {source: settings.manualSourceCurrency, target: settings.targetCurrency});
  $("manual-only").textContent = t("manualOnly", {source: settings.manualSourceCurrency, target: settings.targetCurrency});
  $("manual-target").textContent = settings.targetCurrency;
  if ((document.activeElement !== $("manual-rate") || !pendingSettings.has("manualRate")) && $("manual-rate").value !== settings.manualRate) $("manual-rate").value = settings.manualRate;
  populateSelect($("source-currency"), codes, settings.manualSourceCurrency);
  populateSelect($("target-currency"), codes, settings.targetCurrency);
  if (inSetup) renderSetup();
  for (const button of document.querySelectorAll("[data-precision]")) {
    const active = button.dataset.precision === settings.precision;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  const accent = renderTheme();
  if (settingsLoaded) {
    try {
      localStorage.setItem("popupState", JSON.stringify({accentColor: settings.accentColor, enabled: settings.enabled, language: settings.language, setupDone: settings.setupDone, setupStep: settings.setupStep}));
    } catch {}
    if (!themeReady) {
      themeReady = true;
      requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("theme-ready")));
    }
  }
  if (!$("color-picker").hidden && !liveAccent && document.activeElement !== $("hex-input")) $("hex-input").value = accent.toUpperCase();
  renderRate();
  renderStats();
  if (!viewReady) {
    viewReady = true;
    resizePopup();
  }
}

function fitRate() {
  const rateValue = $("rate-value");
  const container = rateValue.parentElement;
  const unit = $("unit-value").getBoundingClientRect();
  if (!unit.height) {
    container.dataset.size = rateValue.textContent.length > 18 ? "small" : rateValue.textContent.length > 9 ? "medium" : "large";
    return;
  }
  for (const size of ["large", "medium", "small"]) {
    container.dataset.size = size;
    if (rateValue.getBoundingClientRect().top < unit.bottom - 2) break;
  }
}

function renderSetup() {
  const settings = state.settings;
  const step = settings.setupStep;
  const last = SteamFX.setupSteps - 1;
  for (const element of document.querySelectorAll(".setup-step")) element.hidden = Number(element.dataset.step) !== step;
  document.querySelectorAll(".setup-progress span").forEach((bar, index) => bar.classList.toggle("on", index <= step));
  $("setup-count").textContent = t("setupStep", {step: step + 1, total: SteamFX.setupSteps});
  $("setup-back").hidden = step === 0;
  $("setup-next").textContent = t(step === last ? "start" : "next");
  for (const button of $("setup-languages").children) button.setAttribute("aria-pressed", String(button.dataset.language === settings.language));
  populateSelect($("setup-source"), codes, settings.manualSourceCurrency);
  populateSelect($("setup-target"), codes, settings.targetCurrency);
  $("setup-source-name").textContent = SteamFX.currencyName(settings.manualSourceCurrency, settings.language);
  $("setup-target-name").textContent = SteamFX.currencyName(settings.targetCurrency, settings.language);
  $("summary-language").textContent = SteamFX.languages[settings.language];
  $("summary-currencies").textContent = `${settings.manualSourceCurrency} → ${settings.targetCurrency}`;
  $("summary-display").textContent = t(modeKeys[SteamFX.displayMode(settings)]);
}

function renderSetupRate() {
  const settings = state.settings;
  const rate = SteamFX.resolveRate(state, settings.manualSourceCurrency);
  if (!rate) {
    $("setup-rate").replaceChildren(node("span", "setup-rate-status", t(loading ? "fetching" : "unavailable")));
    return;
  }
  $("setup-rate").replaceChildren(
    node("span", "", `1 ${SteamFX.currencies[settings.manualSourceCurrency].symbol}`),
    node("span", "rate-equals", "="),
    node("strong", "", `${SteamFX.formatRate(rate.rate, settings.language)} ${SteamFX.currencies[settings.targetCurrency].symbol}`)
  );
}

function buildLanguages() {
  for (const [code, name] of Object.entries(SteamFX.languages)) {
    const option = new Option(name, code);
    option.lang = code;
    $("language-select").append(option);
    const button = node("button", "language-option");
    button.type = "button";
    button.lang = code;
    button.dataset.language = code;
    button.append(node("span", "", name), icon("check-icon"));
    button.addEventListener("click", () => chooseLanguage(code));
    $("setup-languages").append(button);
  }
}

function chooseLanguage(language) {
  const settings = state.settings;
  const patch = {language};
  if (!settings.setupDone && settings.targetCurrency === SteamFX.currencyFor(settings.language) && SteamFX.currencyFor(language) !== settings.manualSourceCurrency) patch.targetCurrency = SteamFX.currencyFor(language);
  change(patch, Boolean(patch.targetCurrency && patch.targetCurrency !== settings.targetCurrency));
}

function goToStep(step) {
  const back = document.activeElement === $("setup-back");
  change({setupStep: Math.min(SteamFX.setupSteps - 1, Math.max(0, step))});
  if (back && $("setup-back").hidden) $("setup-next").focus();
}

function priceSamples() {
  const settings = state.settings;
  const source = settings.manualSourceCurrency;
  const rate = SteamFX.resolveRate(state, source);
  const sample = {...settings, precision: "0"};
  return {
    original: amount => SteamFX.dualOriginal(SteamFX.formatMoney(amount, source, sample)),
    converted: amount => rate ? SteamFX.formatMoney(amount * rate.rate, settings.targetCurrency, settings) : "—"
  };
}

function priceChip(mode, samples) {
  const chip = node("span", "scene-chip");
  if (mode === "dual") chip.append(node("span", "dual-original", `${samples.original(1000)}${SteamFX.dualSeparator}`));
  chip.append(node("span", "dual-converted", samples.converted(1000)));
  if (mode === "hover") chip.append(icon("cursor-icon", "scene-cursor"));
  return chip;
}

function renderScenes() {
  const samples = priceSamples();
  for (const scene of document.querySelectorAll("[data-scene]")) {
    const mode = scene.dataset.scene;
    const parts = [];
    if (mode === "hover") {
      const tip = node("span", "scene-tip");
      tip.append(node("b", "", t("tipLabel")), node("span", "", samples.original(1000)));
      parts.push(tip);
    }
    parts.push(priceChip(mode, samples));
    scene.replaceChildren(...parts);
  }
  const mode = SteamFX.displayMode(state.settings);
  const line = node("span", "preview-line");
  line.append(node("span", "dual-pct", "-50%"), node("s", "dual-old", samples.converted(2000)), priceChip(mode, samples));
  const parts = [line];
  if (mode === "hover") {
    const tip = node("span", "scene-tip");
    const prices = node("span");
    prices.append(node("s", "", samples.original(2000)), samples.original(1000));
    tip.append(node("b", "", t("tipLabels")), prices);
    parts.push(tip);
  }
  $("display-preview").replaceChildren(...parts);
}

function renderLogo(color) {
  if (color === logoColor) return;
  logoColor = color;
  if (logoFrame) return;
  logoFrame = requestAnimationFrame(() => {
    logoFrame = 0;
    logoSource.decode().then(drawLogo).catch(() => {});
  });
}

function drawLogo() {
  const color = logoColor;
  const size = Math.min(128, Math.ceil(logo.width * Math.max(1, devicePixelRatio)));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", {willReadFrequently: true});
  context.imageSmoothingQuality = "high";
  context.drawImage(logoSource, 0, 0, size, size);
  const image = context.getImageData(0, 0, size, size);
  SteamFXTheme.tintPixels(image.data, color);
  context.putImageData(image, 0, 0);
  const src = canvas.toDataURL("image/png");
  if (color !== logoColor) return;
  logo.src = src;
  if (liveAccent) return;
  try {
    localStorage.setItem("popupLogo", JSON.stringify({color, src}));
  } catch {}
}

function renderTheme() {
  const accent = SteamFXTheme.apply(root, liveAccent || state.settings.accentColor);
  renderLogo(accent);
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
    button.append(icon("check-icon"));
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
  const provider = playwallet ? "PlayWallet" : "SteamCurrency";
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
  fitRate();
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
    const time = new Intl.DateTimeFormat(SteamFX.localeOf(settings.language), {day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"}).format(rate.fetchedAt);
    $("rate-status").textContent = t("cached", {time});
    $("provider-date").textContent = provider;
  } else $("rate-status").textContent = t(rate ? "automatic" : "unavailable");
  let error = "";
  if (storageError) error = t("storageError");
  else if (!settings.manualEnabled && settings.enabled && rate?.stale) error = t("staleHint");
  else if (!settings.manualEnabled && settings.enabled && !rate && failure) error = t(failure.code === "PAIR_UNAVAILABLE" ? "pairError" : failure.code === "FORMAT" ? "formatError" : "networkError");
  $("error").hidden = !error;
  $("error").textContent = error;
  renderScenes();
  renderSetupRate();
  renderCalculator();
  renderCalcView();
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

function showView(name, opener = null) {
  if (!views.includes(name)) return;
  closePicker(false);
  if (name !== "calculator") closeCalcPicker();
  const previous = currentView;
  currentView = name;
  for (const view of views) $(`${view}-panel`).hidden = view !== name;
  document.body.classList.toggle("subview", name !== "prices");
  if (name === "prices") {
    fitRate();
    if (previous !== "prices" && viewOpener?.isConnected) viewOpener.focus();
    viewOpener = null;
  } else {
    if (opener) viewOpener = opener;
    if (opener && document.activeElement === opener) $(`${name}-panel`).querySelector("[data-back]").focus();
  }
  if (name === "calculator") {
    renderCalcView();
    loadCalcRates();
  }
  resizePopup();
}

function calcOrder() {
  const settings = state.settings;
  return [...new Set(settings.calcCurrencies.includes(settings.targetCurrency) ? settings.calcCurrencies : [settings.targetCurrency, ...settings.calcCurrencies])];
}

function calcTargets() {
  return calcOrder().filter(code => code !== state.settings.calcSource);
}

function calcExtras() {
  return state.settings.calcCurrencies.filter(code => code !== state.settings.targetCurrency);
}

function saveCalcOrder(visible) {
  const shown = new Set(visible);
  let index = 0;
  change({calcCurrencies: calcOrder().map(code => shown.has(code) ? visible[index++] : code)});
}

function animateRows(mutate) {
  const container = $("calc-rows");
  const before = new Map([...container.children].map(row => [row, row.getBoundingClientRect().top]));
  mutate();
  const rows = [...container.children];
  for (const row of rows) {
    row.style.transition = "none";
    row.style.transform = "";
  }
  for (const row of rows) {
    const delta = (before.get(row) ?? row.getBoundingClientRect().top) - row.getBoundingClientRect().top;
    if (delta) row.style.transform = `translateY(${delta}px)`;
  }
  container.getBoundingClientRect();
  for (const row of rows) {
    row.style.transition = "";
    row.style.transform = "";
  }
}

function moveCalcRow(code, offset) {
  const order = calcTargets();
  const from = order.indexOf(code);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= order.length) return;
  order.splice(to, 0, order.splice(from, 1)[0]);
  const handle = calcRows.get(code).handle;
  animateRows(() => saveCalcOrder(order));
  handle.focus();
  $("calc-announce").textContent = t("calcMoved", {code, position: to + 1, total: order.length});
}

function startRowDrag(event, code) {
  if (event.button !== 0 || rowDrag || calcTargets().length < 2) return;
  event.preventDefault();
  const container = $("calc-rows");
  const rows = [...container.children];
  const row = calcRows.get(code).row;
  const index = rows.indexOf(row);
  if (index < 0) return;
  event.currentTarget.setPointerCapture(event.pointerId);
  rowDrag = {code, pointer: event.pointerId, startY: event.clientY, index, target: index, rows, rects: rows.map(item => item.getBoundingClientRect())};
  row.classList.add("dragging");
  container.classList.add("sorting");
}

function moveRowDrag(event) {
  if (!rowDrag || event.pointerId !== rowDrag.pointer) return;
  const {rows, rects, index} = rowDrag;
  const own = rects[index];
  const offset = Math.min(rects[rects.length - 1].bottom - own.bottom, Math.max(rects[0].top - own.top, event.clientY - rowDrag.startY));
  rows[index].style.transform = `translateY(${offset}px)`;
  let target = index;
  for (let position = index + 1; position < rects.length; position++) if (own.bottom + offset > rects[position].top + rects[position].height / 2) target = position;
  for (let position = index - 1; position >= 0; position--) if (own.top + offset < rects[position].top + rects[position].height / 2) target = position;
  rowDrag.target = target;
  rows.forEach((item, position) => {
    if (position === index) return;
    const shift = index < target && position > index && position <= target ? -own.height : index > target && position >= target && position < index ? own.height : 0;
    item.style.transform = shift ? `translateY(${shift}px)` : "";
  });
}

function endRowDrag(event) {
  if (!rowDrag || event.pointerId !== rowDrag.pointer) return;
  const {code, index, target, rows} = rowDrag;
  rowDrag = null;
  rows[index].classList.remove("dragging");
  $("calc-rows").classList.remove("sorting");
  const order = rows.map(row => row.dataset.code);
  if (target === index) {
    animateRows(() => {});
    return;
  }
  order.splice(target, 0, order.splice(index, 1)[0]);
  animateRows(() => saveCalcOrder(order));
  $("calc-announce").textContent = t("calcMoved", {code, position: target + 1, total: order.length});
}

function calcRow(code) {
  if (calcRows.has(code)) return calcRows.get(code);
  const row = node("div", "calc-row");
  row.dataset.code = code;
  const handle = node("button", "drag-handle");
  handle.type = "button";
  handle.append(icon("grip-icon"));
  handle.addEventListener("pointerdown", event => startRowDrag(event, code));
  handle.addEventListener("pointermove", moveRowDrag);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(type, endRowDrag);
  handle.addEventListener("keydown", event => {
    const offset = {ArrowUp: -1, ArrowDown: 1}[event.key];
    if (!offset) return;
    event.preventDefault();
    moveCalcRow(code, offset);
  });
  const name = node("span", "calc-name");
  const label = node("span");
  const hint = node("small");
  name.append(label, hint);
  const value = node("output", "calc-value");
  const copy = node("button", "copy-button");
  copy.type = "button";
  const glyph = icon("copy-icon");
  copy.append(glyph);
  copy.addEventListener("click", () => copyValue(code, copy.dataset.value || ""));
  row.append(handle, node("span", "calc-code", code), name, value, copy);
  const item = {row, handle, label, hint, value, copy, glyph};
  calcRows.set(code, item);
  return item;
}

function renderCalcView() {
  if (currentView !== "calculator") return;
  const settings = state.settings;
  populateSelect($("calc-source"), codes, settings.calcSource);
  const amount = SteamFXPrices.parseAmount($("calc-amount").value);
  $("calc-amount").setAttribute("aria-invalid", String(amount === null));
  const targets = calcTargets();
  const rates = targets.map(code => SteamFX.resolvePair(state, settings.calcSource, code));
  const items = targets.map((code, index) => {
    const item = calcRow(code);
    const rate = rates[index];
    const main = code === settings.targetCurrency;
    const text = amount !== null && rate ? SteamFX.formatMoney(amount * rate.rate, code, settings) : "";
    item.row.classList.toggle("main", main);
    item.label.textContent = SteamFX.currencyName(code, settings.language);
    item.hint.textContent = main ? t("calcMain") : "";
    item.hint.hidden = !main;
    item.value.textContent = text || (amount === null ? "—" : calcLoading ? "…" : t("rowNoRate"));
    item.value.classList.toggle("missing", !text);
    item.copy.dataset.value = text;
    item.copy.disabled = !text;
    item.copy.title = t("calcCopy");
    item.copy.setAttribute("aria-label", text ? `${t("calcCopy")}: ${text}` : t("calcCopy"));
    item.copy.classList.toggle("copied", copiedCode === code);
    item.handle.setAttribute("aria-label", t("calcMove", {code}));
    item.glyph.firstChild.setAttribute("href", copiedCode === code ? "#check-icon" : "#copy-icon");
    return item.row;
  });
  const container = $("calc-rows");
  if (!rowDrag && (items.length !== container.children.length || items.some((row, index) => container.children[index] !== row))) container.replaceChildren(...items);
  container.hidden = !items.length;
  container.classList.toggle("single", items.length < 2);
  const automatic = settings.enabled && !settings.manualEnabled;
  let status = "";
  if (calcLoading) status = t("fetching");
  else if (!settings.enabled) status = t("paused");
  else if (rates.some(rate => rate?.source === "manual")) status = t("manualOnly", {source: settings.manualSourceCurrency, target: settings.targetCurrency});
  else if (rates.some(rate => rate?.stale)) status = t("staleHint");
  else if (automatic && targets.some((code, index) => !rates[index] && state.rateFailures[SteamFX.pairKey(settings.calcSource, code)]?.code === "NETWORK")) status = t("networkError");
  else {
    const times = rates.filter(rate => rate?.fetchedAt).map(rate => rate.fetchedAt);
    if (times.length) status = t("cached", {time: new Intl.DateTimeFormat(SteamFX.localeOf(settings.language), {day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"}).format(Math.min(...times))});
    else if (!rates.some(Boolean)) status = t("unavailable");
  }
  $("calc-status").textContent = status;
  $("calc-refresh").disabled = calcLoading || !automatic || !items.length;
  $("calc-refresh").classList.toggle("loading", calcLoading);
  if (calcEditing) renderCalcPicker();
  resizePopup();
}

async function loadCalcRates(force = false) {
  const settings = state.settings;
  const pairs = calcTargets().map(code => [settings.calcSource, code]);
  if (!pairs.length) return;
  const version = ++calcVersion;
  const revision = cacheRevision;
  calcLoading = settings.enabled && !settings.manualEnabled;
  renderCalcView();
  try {
    const response = await chrome.runtime.sendMessage({type: "GET_PAIRS", pairs, force});
    if (version !== calcVersion) return;
    if (response?.ok && revision === cacheRevision) {
      state.rateCache = response.state.rateCache || {entries: {}};
      state.rateFailures = response.state.rateFailures || {};
    }
  } catch {
  } finally {
    if (version === calcVersion) {
      calcLoading = false;
      renderCalcView();
    }
  }
}

async function copyValue(code, text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = node("textarea", "visually-hidden", text);
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  copiedCode = code;
  $("calc-announce").textContent = t("calcCopied", {value: text});
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedCode = "";
    renderCalcView();
  }, 1400);
  renderCalcView();
}

function buildCalcGrid() {
  for (const code of codes) {
    const button = node("button", "", code);
    button.type = "button";
    button.dataset.code = code;
    button.addEventListener("click", () => toggleCalcCurrency(code));
    $("calc-grid").append(button);
  }
}

function renderCalcPicker() {
  const settings = state.settings;
  const selected = calcExtras();
  for (const button of $("calc-grid").children) {
    const code = button.dataset.code;
    const main = code === settings.targetCurrency;
    const on = selected.includes(code);
    button.classList.toggle("main", main);
    button.disabled = main || !on && selected.length >= SteamFX.calcLimit;
    button.setAttribute("aria-pressed", String(main || on));
    button.title = main ? `${SteamFX.currencyName(code, settings.language)}. ${t("calcMain")}` : SteamFX.currencyName(code, settings.language);
  }
  $("calc-meta").textContent = t("calcSelected", {count: selected.length, max: SteamFX.calcLimit});
}

function toggleCalcCurrency(code) {
  const list = state.settings.calcCurrencies;
  if (code === state.settings.targetCurrency) return;
  if (list.includes(code)) change({calcCurrencies: list.filter(item => item !== code)});
  else if (calcExtras().length < SteamFX.calcLimit) change({calcCurrencies: [...list, code]});
}

function openCalcPicker() {
  calcEditing = true;
  $("calc-list").hidden = true;
  $("calc-picker").hidden = false;
  renderCalcPicker();
  resizePopup();
}

function closeCalcPicker() {
  if (!calcEditing) return;
  calcEditing = false;
  $("calc-list").hidden = false;
  $("calc-picker").hidden = true;
  $("calc-meta").textContent = "";
  if (currentView === "calculator") {
    renderCalcView();
    loadCalcRates();
    $("calc-edit").focus();
  }
  resizePopup();
}

$("language-select").addEventListener("change", event => chooseLanguage(event.target.value));
$("open-calculator").addEventListener("click", event => showView("calculator", event.currentTarget));
$("open-settings").addEventListener("click", event => showView("settings", event.currentTarget));
for (const button of document.querySelectorAll("[data-back]")) button.addEventListener("click", () => {
  if (calcEditing) closeCalcPicker();
  else showView("prices");
});
$("calc-amount").addEventListener("input", event => {
  try {
    localStorage.setItem("calcAmount", event.target.value);
  } catch {}
  renderCalcView();
});
$("calc-source").addEventListener("change", event => {
  change({calcSource: event.target.value});
  loadCalcRates();
});
$("calc-refresh").addEventListener("click", () => loadCalcRates(true));
$("calc-edit").addEventListener("click", openCalcPicker);
$("calc-done").addEventListener("click", closeCalcPicker);
$("setup-source").addEventListener("change", event => change({manualSourceCurrency: event.target.value}, true));
$("setup-target").addEventListener("change", event => change({targetCurrency: event.target.value}, true));
$("setup-next").addEventListener("click", () => {
  const step = state.settings.setupStep;
  if (step < SteamFX.setupSteps - 1) goToStep(step + 1);
  else change({setupDone: true, setupStep: 0});
});
$("setup-back").addEventListener("click", () => goToStep(state.settings.setupStep - 1));
for (const button of document.querySelectorAll("[data-mode]")) button.addEventListener("click", () => change(SteamFX.displayPatch(button.dataset.mode)));
$("enabled").addEventListener("change", event => change({enabled: event.target.checked}, true));
$("manual-enabled").addEventListener("change", event => change({manualEnabled: event.target.checked}, true));
$("source-currency").addEventListener("change", event => change({manualSourceCurrency: event.target.value}, true));
$("target-currency").addEventListener("change", event => change({targetCurrency: event.target.value}, true));
$("refresh").addEventListener("click", () => loadState(true));
$("manual-rate").addEventListener("input", event => {
  change({manualRate: event.target.value});
});
$("calculator-amount").addEventListener("input", renderCalculator);
for (const button of document.querySelectorAll("[data-precision]")) button.addEventListener("click", () => change({precision: button.dataset.precision}));
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
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || event.defaultPrevented || !$("setup").hidden || currentView === "prices") return;
  event.preventDefault();
  if (calcEditing) closeCalcPicker();
  else showView("prices");
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

$("version").textContent = `Currency Lens ${chrome.runtime.getManifest().version}`;
try {
  const amount = localStorage.getItem("calcAmount");
  if (typeof amount === "string" && amount.length <= 24) $("calc-amount").value = amount;
} catch {}
buildLanguages();
buildSwatches();
buildCalcGrid();
showView("prices");
if (cachedView) {
  state.settings = SteamFX.normalizeSettings({...SteamFX.defaults, ...cachedView});
  renderUI();
}
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
