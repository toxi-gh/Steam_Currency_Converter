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
const anchorPrice = 10;
const fallbackAmount = 100;
const anchorRequests = new Set();
const amountFields = {quick: {id: "calculator-amount", code: "", touched: false}, calc: {id: "calc-amount", code: "", touched: false}};
let ratesLoaded = false;
let quickReverse = false;
let updateInfo = null;
const currencyPicker = {button: null, field: "", items: [], active: 0};
let copyTimer = 0;

try {
  const cached = JSON.parse(localStorage.getItem("popupState") || "null");
  if (cached && typeof cached === "object") cachedView = cached;
  const cachedLogo = JSON.parse(localStorage.getItem("popupLogo") || "null");
  if (cachedView && typeof cachedLogo?.src === "string" && cachedLogo.src.startsWith("data:image/png") && cachedLogo.version === 2 && cachedLogo.color === SteamFXTheme.ensureReadable(cachedView.accentColor)) {
    logo.src = cachedLogo.src;
    logoColor = cachedLogo.color;
  }
} catch {}
logoSource.src = "icons/128.png";

function resizePopup() {
  if (resizeFrame || !viewReady) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    const area = popupContent.getBoundingClientRect();
    let height = Math.ceil(area.height);
    if (!height) return;
    if (!$("rate-menu").hidden) height = Math.min(600, Math.max(height, Math.ceil($("rate-menu").getBoundingClientRect().bottom - area.top + 12)));
    const value = `${height}px`;
    if (document.body.style.height !== value) document.body.style.height = value;
    if (!popupReady) {
      popupReady = true;
      requestAnimationFrame(() => document.body.classList.add("popup-ready"));
    }
  });
}

if (typeof ResizeObserver === "function") new ResizeObserver(resizePopup).observe(popupContent);
document.fonts?.ready.then(() => {
  fitRate();
  renderSetupRate();
  resizePopup();
});
document.fonts?.addEventListener("loadingdone", () => {
  fitRate();
  renderSetupRate();
  resizePopup();
});

function t(key, values) {
  return SteamFXI18n.translate(state.settings.language, key, values);
}

function renderCurrencyButton(button, code) {
  const name = SteamFX.currencyName(code, state.settings.language);
  if (button.dataset.code !== code || !button.firstChild) {
    button.dataset.code = code;
    button.replaceChildren(node("b", "", code), node("span", "", SteamFX.currencies[code].symbol), icon("chevron-icon"));
  }
  button.title = name;
  button.setAttribute("aria-label", `${button.dataset.label ? `${t(button.dataset.label)}: ` : ""}${code}, ${name}`);
  button.setAttribute("aria-expanded", String(currencyPicker.button === button));
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
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) element.placeholder = t(element.dataset.i18nPlaceholder);
  const inSetup = !settings.setupDone;
  if (!$("setup").hidden && !inSetup) showView("prices");
  $("setup").hidden = !inSetup;
  $("app").hidden = inSetup;
  document.body.classList.toggle("in-setup", inSetup);
  renderLanguageButton();
  $("enabled").checked = settings.enabled;
  $("power-state").textContent = t(settings.enabled ? "stateOn" : "stateOff");
  $("enabled-switch").classList.toggle("on", settings.enabled);
  const mode = SteamFX.displayMode(settings);
  for (const button of document.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  $("manual-fields").hidden = !settings.manualEnabled;
  $("rate-auto").hidden = settings.manualEnabled;
  for (const button of document.querySelectorAll("[data-rate-mode]")) button.setAttribute("aria-checked", String((button.dataset.rateMode === "manual") === settings.manualEnabled));
  $("manual-unit").textContent = t("manualUnit", {source: settings.manualSourceCurrency, target: settings.targetCurrency});
  if ((document.activeElement !== $("manual-rate") || !pendingSettings.has("manualRate")) && $("manual-rate").value !== settings.manualRate) $("manual-rate").value = settings.manualRate;
  renderCurrencyButton($("source-currency"), settings.manualSourceCurrency);
  renderCurrencyButton($("target-currency"), settings.targetCurrency);
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
  renderUpdate();
  if (!viewReady) {
    viewReady = true;
    resizePopup();
  }
}

function fitRateText(element, rate, currency) {
  const container = element.parentElement;
  const full = SteamFX.formatRateAmount(rate, currency);
  element.title = full;
  element.textContent = full;
  const labels = [...container.children].filter(child => child !== element);
  for (const label of labels) label.hidden = false;
  const whole = Math.max(2, Math.floor(Math.log10(rate)) + 1);
  if (!container.getBoundingClientRect().width) return;
  const fits = () => container.scrollWidth <= container.clientWidth + 0.5;
  for (const compact of [false, true]) {
    if (compact) for (const label of labels) label.hidden = true;
    for (let digits = 10; digits >= whole; digits--) {
      element.textContent = SteamFX.formatRateAmount(rate, currency, digits);
      if (fits()) return;
    }
  }
}

function fitResult() {
  const result = $("calculator-result");
  result.classList.remove("long");
  if (result.clientWidth && result.scrollWidth > result.clientWidth + 0.5) result.classList.add("long");
}

function fitRate() {
  fitResult();
  const rateValue = $("rate-value");
  const rate = SteamFX.resolveRate(state, state.settings.manualSourceCurrency);
  if (!rate) {
    rateValue.textContent = "—";
    rateValue.removeAttribute("title");
    return;
  }
  fitRateText(rateValue, rate.rate, state.settings.targetCurrency);
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
  renderCurrencyButton($("setup-source"), settings.manualSourceCurrency);
  renderCurrencyButton($("setup-target"), settings.targetCurrency);
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
  const value = node("strong");
  $("setup-rate").replaceChildren(
    node("span", "", unitText(settings.manualSourceCurrency)),
    node("span", "rate-equals", "="),
    value
  );
  fitRateText(value, rate.rate, settings.targetCurrency);
}

function renderLanguageButton() {
  const button = $("language-select");
  const code = state.settings.language;
  if (button.dataset.code !== code || !button.firstChild) {
    button.dataset.code = code;
    const label = node("span", "", SteamFX.languages[code]);
    label.lang = code;
    button.replaceChildren(label, icon("chevron-icon"));
  }
  button.setAttribute("aria-label", `${t("language")}: ${SteamFX.languages[code]}`);
  button.setAttribute("aria-expanded", String(currencyPicker.button === button));
}

function buildLanguages() {
  for (const [code, name] of Object.entries(SteamFX.languages)) {
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
    if (mode === "hover") parts.push(node("span", "scene-tip", samples.original(1000)));
    parts.push(priceChip(mode, samples));
    scene.replaceChildren(...parts);
  }
  const mode = SteamFX.displayMode(state.settings);
  const line = node("span", "preview-line");
  line.append(node("span", "dual-pct", "-50%"), node("s", "dual-old", samples.converted(2000)), priceChip(mode, samples));
  const parts = [line];
  if (mode === "hover") {
    const tip = node("span", "scene-tip");
    tip.append(node("s", "", samples.original(2000)), node("span", "", samples.original(1000)));
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
  SteamFXTheme.tintFill(image.data, color);
  context.putImageData(image, 0, 0);
  const src = canvas.toDataURL("image/png");
  if (color !== logoColor) return;
  logo.src = src;
  if (liveAccent) return;
  try {
    localStorage.setItem("popupLogo", JSON.stringify({color, src, version: 2}));
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
  const sourceUrl = playwallet ? "https://playwallet.bot/steam-currency" : "https://steam-currency.ru/";
  sourceLink.href = sourceUrl;
  $("menu-source").href = sourceUrl;
  sourceLink.querySelector("strong").textContent = playwallet ? "playwallet.bot" : "steam-currency.ru";
  sourceLink.hidden = !["widget", "table", "playwallet"].includes(rate?.source);
  $("source-card").hidden = sourceLink.hidden;
  $("menu-copy").disabled = !rate || rate.source === "identity";
  const key = SteamFX.pairKey(settings.manualSourceCurrency, settings.targetCurrency);
  const failure = state.rateFailures[key];
  const manualInvalid = settings.manualEnabled && settings.manualSourceCurrency !== settings.targetCurrency && !SteamFX.positiveRate(settings.manualRate);
  $("manual-validation").hidden = !manualInvalid;
  $("manual-rate").setAttribute("aria-invalid", String(manualInvalid));
  $("unit-value").textContent = unitText(settings.manualSourceCurrency);
  fitRate();
  $("refresh").disabled = loading || settings.manualEnabled || settings.manualSourceCurrency === settings.targetCurrency;
  $("refresh").classList.toggle("loading", loading);
  const status = $("rate-status");
  status.classList.toggle("stale", Boolean(rate?.stale) && !loading);
  status.removeAttribute("title");
  if (loading) status.textContent = t("fetching");
  else if (rate?.stale) status.textContent = t("stale");
  else if (rate?.fetchedAt) {
    const time = new Intl.DateTimeFormat(SteamFX.localeOf(settings.language), {day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"}).format(rate.fetchedAt);
    status.textContent = t("cached", {time});
    status.title = provider;
  } else status.textContent = rate ? "" : t("unavailable");
  let error = "";
  if (storageError) error = t("storageError");
  else if (!settings.manualEnabled && rate?.stale) error = t("staleHint");
  else if (!settings.manualEnabled && !rate && failure) error = t(failure.code === "PAIR_UNAVAILABLE" ? "pairError" : failure.code === "FORMAT" ? "formatError" : "networkError");
  $("error").hidden = !error;
  $("error").textContent = error;
  renderScenes();
  renderSetupRate();
  renderCalculator();
  renderCalcView();
}

function unitText(code) {
  return SteamFX.formatMoney(1, code, {precision: "0"});
}

function usdValue(code) {
  if (code === "USD") return 1;
  const edges = new Map();
  const link = (from, to, rate) => {
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from).push([to, rate]);
  };
  for (const [key, entry] of Object.entries(state.rateCache?.entries || {})) {
    const [from, to] = key.split(":");
    const rate = SteamFX.positiveRate(entry?.rate);
    if (!rate || from === to || !SteamFX.isCurrency(from) || !SteamFX.isCurrency(to)) continue;
    link(from, to, rate);
    link(to, from, 1 / rate);
  }
  const settings = state.settings;
  const manual = SteamFX.resolveRate(state, settings.manualSourceCurrency);
  if (manual?.source === "manual") {
    link(settings.manualSourceCurrency, settings.targetCurrency, manual.rate);
    link(settings.targetCurrency, settings.manualSourceCurrency, 1 / manual.rate);
  }
  const values = new Map([[code, 1]]);
  const queue = [code];
  while (queue.length) {
    const current = queue.shift();
    for (const [next, rate] of edges.get(current) || []) {
      if (values.has(next)) continue;
      const value = values.get(current) * rate;
      if (next === "USD") return value;
      values.set(next, value);
      queue.push(next);
    }
  }
  return null;
}

function roundAmount(value) {
  const exponent = Math.floor(Math.log10(value));
  let best = 1;
  let distance = Infinity;
  for (let power = exponent - 1; power <= exponent + 1; power++) {
    for (const step of [1, 2, 5]) {
      const candidate = Math.round(step * 10 ** power);
      const gap = Math.abs(Math.log(candidate / value));
      if (candidate >= 1 && gap < distance) {
        best = candidate;
        distance = gap;
      }
    }
  }
  return best;
}

function requestAnchor(code) {
  const settings = state.settings;
  if (anchorRequests.has(code) || settings.manualEnabled) return;
  anchorRequests.add(code);
  chrome.runtime.sendMessage({type: "GET_PAIRS", pairs: [[code, "USD"]]}).catch(() => {});
}

function suggestAmount(field, code) {
  if (field.code !== code) {
    field.code = code;
    field.touched = false;
  }
  if (field.touched || !ratesLoaded) return;
  const usd = usdValue(code);
  if (!usd) requestAnchor(code);
  const value = String(usd ? roundAmount(anchorPrice / usd) : fallbackAmount);
  if ($(field.id).value !== value) $(field.id).value = value;
}

function renderCalculator() {
  const settings = state.settings;
  const from = quickReverse ? settings.targetCurrency : settings.manualSourceCurrency;
  const to = quickReverse ? settings.manualSourceCurrency : settings.targetCurrency;
  suggestAmount(amountFields.quick, from);
  $("calculator-source").textContent = from;
  $("quick-swap").setAttribute("aria-pressed", String(quickReverse));
  const amount = SteamFXPrices.parseAmount($("calculator-amount").value);
  const rate = SteamFX.resolveRate(state, settings.manualSourceCurrency);
  const result = $("calculator-result");
  result.textContent = amount !== null && rate ? SteamFX.formatMoney(quickReverse ? amount / rate.rate : amount * rate.rate, to, settings) : "—";
  result.title = result.textContent;
  fitResult();
  $("calculator-amount").setAttribute("aria-invalid", String(amount === null));
  resizePopup();
}

function renderUpdate() {
  const status = SteamFX.updateStatus(updateInfo, chrome.runtime.getManifest().version);
  $("update-card").hidden = !status.available;
  if (!status.available) return;
  $("update-title").textContent = t("updateTitle", {version: status.latest});
  $("update-installed").textContent = t("updateInstalled", {current: status.current});
  $("update-link").href = SteamFX.releasesUrl;
}

function renderStats() {
  $("page-status").hidden = !pageStats;
  $("page-stats").textContent = !pageStats ? "" : state.settings.enabled ? t("converted", {count: pageStats.count}) : t("paused");
  $("page-status").classList.toggle("active", Boolean(state.settings.enabled && pageStats?.count));
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
  if (patch.targetCurrency && patch.targetCurrency !== state.settings.targetCurrency && !patch.calcCurrencies) patch = {...patch, calcCurrencies: leadCurrency(patch.targetCurrency)};
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
  closeCurrencyPicker(false);
  closeRateMenu(false);
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
    if (previous !== "calculator") amountFields.calc.touched = false;
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
  renderCurrencyButton($("calc-source"), settings.calcSource);
  suggestAmount(amountFields.calc, settings.calcSource);
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
  const automatic = !settings.manualEnabled;
  let status = "";
  if (calcLoading) status = t("fetching");
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
  calcLoading = !settings.manualEnabled;
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

function leadCurrency(target) {
  const previous = state.settings.targetCurrency;
  const order = [target, ...calcOrder().filter(code => code !== target)];
  return order.length - 1 > SteamFX.calcLimit ? order.filter(code => code !== previous) : order;
}

function currencyMatches(query) {
  const text = query.trim().toLocaleLowerCase();
  if (!text) return [...codes];
  const language = state.settings.language;
  return codes.map((code, index) => {
    const names = [...new Set([SteamFX.currencyName(code, language), SteamFX.currencyName(code, "en")].map(name => name.toLocaleLowerCase()))];
    const symbol = SteamFX.currencies[code].symbol.toLocaleLowerCase();
    const lower = code.toLowerCase();
    let score = 0;
    if (lower === text || symbol === text) score = 5;
    else if (lower.startsWith(text)) score = 4;
    else if (names.some(name => name.startsWith(text))) score = 3;
    else if (names.some(name => name.split(/[\s-]+/).some(word => word.startsWith(text)))) score = 2;
    else if (names.some(name => name.includes(text)) || symbol.includes(text)) score = 1;
    return {code, score, index};
  }).filter(item => item.score).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.code);
}

function pickerOption(code) {
  const option = node("button", "currency-option");
  if (currencyPicker.field === "language") {
    option.classList.add("language-choice");
    option.lang = code;
    option.append(node("span", "option-name", SteamFX.languages[code]), icon("check-icon"));
  } else option.append(node("b", "", code), node("span", "option-name", SteamFX.currencyName(code, state.settings.language)), node("span", "option-symbol", SteamFX.currencies[code].symbol), icon("check-icon"));
  return option;
}

function pickerFocus() {
  return currencyPicker.field === "language" ? $("currency-list") : $("currency-search");
}

function renderCurrencyList() {
  const language = currencyPicker.field === "language";
  const selected = state.settings[currencyPicker.field];
  const query = language ? "" : $("currency-search").value;
  const items = language ? Object.keys(SteamFX.languages) : currencyMatches(query);
  currencyPicker.items = items;
  currencyPicker.active = query.trim() ? 0 : Math.max(0, items.indexOf(selected));
  $("currency-list").replaceChildren(...items.map((code, index) => {
    const option = pickerOption(code);
    option.type = "button";
    option.id = `currency-option-${code}`;
    option.tabIndex = -1;
    option.dataset.code = code;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(code === selected));
    option.addEventListener("pointerdown", event => event.preventDefault());
    option.addEventListener("click", () => chooseCurrency(code));
    option.addEventListener("pointermove", () => {
      if (currencyPicker.active !== index) setActiveCurrency(index, false);
    });
    return option;
  }));
  $("currency-list").hidden = !items.length;
  $("currency-empty").hidden = Boolean(items.length);
  setActiveCurrency(currencyPicker.active, true);
}

function setActiveCurrency(index, scroll) {
  const options = $("currency-list").children;
  if (!options.length) {
    pickerFocus().removeAttribute("aria-activedescendant");
    return;
  }
  currencyPicker.active = Math.min(options.length - 1, Math.max(0, index));
  for (const [position, option] of [...options].entries()) option.classList.toggle("active", position === currencyPicker.active);
  const active = options[currencyPicker.active];
  pickerFocus().setAttribute("aria-activedescendant", active.id);
  if (scroll) active.scrollIntoView({block: "nearest"});
}

function positionCurrencyPicker() {
  const element = $("currency-picker");
  const area = popupContent.getBoundingClientRect();
  const anchor = currencyPicker.button.getBoundingClientRect();
  const width = Math.min(currencyPicker.field === "language" ? 220 : 252, area.width - 24);
  const left = Math.min(area.width - width - 12, Math.max(12, (anchor.width > width ? anchor.left : anchor.right - width) - area.left));
  const below = area.bottom - anchor.bottom - 12;
  const above = anchor.top - area.top - 12;
  const down = below >= 230 || below >= above;
  const space = Math.min(300, (down ? below : above) - 6);
  element.style.width = `${width}px`;
  element.style.left = `${left}px`;
  element.style.maxHeight = `${space}px`;
  element.style.top = down ? `${anchor.bottom - area.top + 6}px` : "auto";
  element.style.bottom = down ? "auto" : `${area.bottom - anchor.top + 6}px`;
  element.classList.toggle("above", !down);
}

function openCurrencyPicker(button) {
  if (currencyPicker.button === button) {
    closeCurrencyPicker(true);
    return;
  }
  closeRateMenu(false);
  closeCurrencyPicker(false);
  currencyPicker.button = button;
  currencyPicker.field = button.dataset.currencyField;
  const language = currencyPicker.field === "language";
  button.setAttribute("aria-expanded", "true");
  $("currency-search").value = "";
  $("currency-search").removeAttribute("aria-activedescendant");
  $("currency-list").removeAttribute("aria-activedescendant");
  $("currency-picker").classList.toggle("no-search", language);
  $("currency-list").tabIndex = language ? 0 : -1;
  $("currency-picker").setAttribute("aria-label", language ? t("language") : button.dataset.label ? t(button.dataset.label) : button.closest("[class$='field']")?.querySelector("span")?.textContent || t("search"));
  $("currency-picker").hidden = false;
  positionCurrencyPicker();
  renderCurrencyList();
  pickerFocus().focus();
}

function closeCurrencyPicker(restoreFocus) {
  const button = currencyPicker.button;
  if (!button) return;
  currencyPicker.button = null;
  $("currency-picker").hidden = true;
  button.setAttribute("aria-expanded", "false");
  if (restoreFocus) button.focus();
}

function chooseCurrency(code) {
  const field = currencyPicker.field;
  closeCurrencyPicker(true);
  if (state.settings[field] === code) return;
  if (field === "language") chooseLanguage(code);
  else if (field === "calcSource") {
    change({calcSource: code});
    loadCalcRates();
  } else change({[field]: code}, true);
}

function menuItems() {
  return [...$("rate-menu").querySelectorAll("[role^='menuitem']")].filter(item => !item.disabled);
}

function openRateMenu() {
  closeCurrencyPicker(false);
  $("rate-menu").hidden = false;
  $("rate-menu-button").setAttribute("aria-expanded", "true");
  resizePopup();
  (menuItems().find(item => item.getAttribute("aria-checked") === "true") || menuItems()[0])?.focus();
}

function closeRateMenu(restoreFocus) {
  if ($("rate-menu").hidden) return;
  clearTimeout(copyTimer);
  copyTimer = 0;
  $("menu-copy").classList.remove("copied");
  $("menu-copy").querySelector("span").textContent = t("copyRate");
  $("rate-menu").hidden = true;
  $("rate-menu-button").setAttribute("aria-expanded", "false");
  resizePopup();
  if (restoreFocus) $("rate-menu-button").focus();
}

function chooseRateMode(mode) {
  const manual = mode === "manual";
  closeRateMenu(!manual);
  if (manual !== state.settings.manualEnabled) change({manualEnabled: manual}, true);
  if (manual) requestAnimationFrame(() => $("manual-rate").focus());
}

async function copyRate() {
  const settings = state.settings;
  const rate = SteamFX.resolveRate(state, settings.manualSourceCurrency);
  if (!rate) return;
  const text = `${unitText(settings.manualSourceCurrency)} = ${SteamFX.formatRateAmount(rate.rate, settings.targetCurrency)}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = node("textarea", "visually-hidden", text);
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  $("menu-copy").classList.add("copied");
  $("menu-copy").querySelector("span").textContent = t("copied");
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => closeRateMenu(true), 900);
}

function swapCurrencies() {
  const settings = state.settings;
  if (settings.manualSourceCurrency === settings.targetCurrency) return;
  change({manualSourceCurrency: settings.targetCurrency, targetCurrency: settings.manualSourceCurrency}, true);
}

$("open-calculator").addEventListener("click", event => showView("calculator", event.currentTarget));
$("open-settings").addEventListener("click", event => showView("settings", event.currentTarget));
for (const button of document.querySelectorAll("[data-back]")) button.addEventListener("click", () => {
  if (calcEditing) closeCalcPicker();
  else showView("prices");
});
function selectOnFocus(input) {
  let pointerFocus = false;
  input.addEventListener("mousedown", () => {
    pointerFocus = document.activeElement !== input;
  });
  input.addEventListener("focus", () => input.select());
  input.addEventListener("mouseup", event => {
    if (!pointerFocus) return;
    pointerFocus = false;
    event.preventDefault();
    input.select();
  });
}

selectOnFocus($("calculator-amount"));
document.querySelector(".amount-box").addEventListener("mousedown", event => {
  if (event.target === $("calculator-amount")) return;
  event.preventDefault();
  $("calculator-amount").focus();
});
selectOnFocus($("calc-amount"));
$("calc-amount").addEventListener("input", () => {
  amountFields.calc.touched = true;
  renderCalcView();
});
$("calc-refresh").addEventListener("click", () => loadCalcRates(true));
$("calc-edit").addEventListener("click", openCalcPicker);
$("calc-done").addEventListener("click", closeCalcPicker);
$("setup-next").addEventListener("click", () => {
  const step = state.settings.setupStep;
  if (step < SteamFX.setupSteps - 1) goToStep(step + 1);
  else change({setupDone: true, setupStep: 0});
});
$("setup-back").addEventListener("click", () => goToStep(state.settings.setupStep - 1));
for (const button of document.querySelectorAll("[data-mode]")) button.addEventListener("click", () => change(SteamFX.displayPatch(button.dataset.mode)));
$("enabled").addEventListener("change", event => change({enabled: event.target.checked}, true));
$("refresh").addEventListener("click", () => loadState(true));
$("manual-rate").addEventListener("input", event => {
  change({manualRate: event.target.value});
});
$("calculator-amount").addEventListener("input", () => {
  amountFields.quick.touched = true;
  renderCalculator();
});
$("quick-swap").addEventListener("click", () => {
  quickReverse = !quickReverse;
  renderCalculator();
});
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
for (const button of document.querySelectorAll("[data-currency-field]")) button.addEventListener("click", () => openCurrencyPicker(button));
$("currency-search").addEventListener("input", renderCurrencyList);
function pickerKeys(event) {
  const moves = {ArrowDown: 1, ArrowUp: -1, PageDown: 6, PageUp: -6};
  if (moves[event.key]) {
    event.preventDefault();
    setActiveCurrency(currencyPicker.active + moves[event.key], true);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const code = currencyPicker.items[currencyPicker.active];
    if (code) chooseCurrency(code);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeCurrencyPicker(true);
  } else if (event.key === "Home" || event.key === "End") {
    if (currencyPicker.field !== "language") return;
    event.preventDefault();
    setActiveCurrency(event.key === "Home" ? 0 : currencyPicker.items.length - 1, true);
  } else if (event.key === "Tab") closeCurrencyPicker(false);
}
$("currency-search").addEventListener("keydown", pickerKeys);
$("currency-list").addEventListener("keydown", event => {
  if (currencyPicker.field === "language") pickerKeys(event);
});
$("swap-currencies").addEventListener("click", swapCurrencies);
$("rate-menu-button").addEventListener("click", () => {
  if ($("rate-menu").hidden) openRateMenu();
  else closeRateMenu(true);
});
for (const button of document.querySelectorAll("[data-rate-mode]")) button.addEventListener("click", () => chooseRateMode(button.dataset.rateMode));
$("menu-copy").addEventListener("click", copyRate);
$("menu-source").addEventListener("click", () => closeRateMenu(false));
$("rate-menu").addEventListener("keydown", event => {
  const items = menuItems();
  const index = items.indexOf(document.activeElement);
  const moves = {ArrowDown: 1, ArrowUp: -1};
  if (moves[event.key]) {
    event.preventDefault();
    items[(index + moves[event.key] + items.length) % items.length]?.focus();
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    items[event.key === "Home" ? 0 : items.length - 1]?.focus();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeRateMenu(true);
  } else if (event.key === "Tab") closeRateMenu(false);
});
document.addEventListener("pointerdown", event => {
  if (currencyPicker.button && !$("currency-picker").contains(event.target) && !currencyPicker.button.contains(event.target)) closeCurrencyPicker(false);
  if (!$("rate-menu").hidden && !$("rate-menu").contains(event.target) && !$("rate-menu-button").contains(event.target)) closeRateMenu(false);
}, true);
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
  if (changes.updateInfo) updateInfo = changes.updateInfo.newValue || null;
  if (changes.settings) renderUI();
  else if (changes.rateCache || changes.rateFailures) renderRate();
  if (changes.updateInfo) {
    renderUpdate();
    resizePopup();
  }
});

$("version").textContent = `Currency Lens ${chrome.runtime.getManifest().version}`;
buildLanguages();
buildSwatches();
buildCalcGrid();
showView("prices");
if (cachedView) {
  state.settings = SteamFX.normalizeSettings({...SteamFX.defaults, ...cachedView});
  renderUI();
}
chrome.storage.local.get(["settings", "rateCache", "rateFailures", "updateInfo"]).then(stored => {
  if (!settingsLoaded) state.settings = optimisticSettings(stored.settings);
  updateInfo = stored.updateInfo || null;
  if (!cacheRevision) {
    state.rateCache = stored.rateCache || {entries: {}};
    state.rateFailures = stored.rateFailures || {};
  }
  settingsLoaded = true;
  ratesLoaded = true;
  renderUI();
  loadState();
  readPageStats();
}).catch(() => {
  storageError = true;
  ratesLoaded = true;
  renderUI();
});
setInterval(readPageStats, 700);
