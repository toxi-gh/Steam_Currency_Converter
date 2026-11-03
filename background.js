"use strict";

importScripts("shared.js", "rate-source.js", "theme.js");

const TTL = 6 * 60 * 60 * 1000;
const RETRY_DELAY = 15 * 60 * 1000;
const REFRESH_COOLDOWN = 60 * 1000;
const ALARM = "steam-fx-refresh";
const inFlight = new Map();
const controllers = new Set();
const snapshotRequests = new Map();
let writeQueue = Promise.resolve();
let requestQueue = Promise.resolve();
let alarmQueue = Promise.resolve();
let requestEpoch = 0;
const ICON_SIZES = [16, 32];
let iconBase = null;
let iconKey = "";
let iconQueue = Promise.resolve();

async function settingsNow() {
  const {settings} = await chrome.storage.local.get("settings");
  return SteamFX.normalizeSettings(settings);
}

function updateStored(key, updater) {
  const task = writeQueue.then(async () => {
    const stored = await chrome.storage.local.get(key);
    const value = await updater(stored[key]);
    if (value === undefined) return undefined;
    await chrome.storage.local.set({[key]: value});
    return value;
  });
  writeQueue = task.catch(() => {});
  return task;
}

function isAutomatic(settings) {
  return settings.enabled && !settings.manualEnabled;
}

function fresh(value, force = false) {
  return SteamFX.validTimestamp(value?.fetchedAt) && Date.now() - value.fetchedAt < (force ? REFRESH_COOLDOWN : TTL);
}

function validPair(key) {
  const codes = key.split(":");
  return codes.length === 2 && codes[0] !== codes[1] && codes.every(SteamFX.isCurrency);
}

function validEntry(entry) {
  return Boolean(SteamFX.positiveRate(entry?.rate) && SteamFX.validTimestamp(entry.fetchedAt));
}

function validFailure(failure) {
  return Boolean(SteamFX.validTimestamp(failure?.at) && Number.isFinite(failure.retryAt) && failure.retryAt >= failure.at && ["NETWORK", "FORMAT", "PAIR_UNAVAILABLE"].includes(failure.code));
}

function activeKeys(rateCache, rateFailures) {
  return [...new Set([...Object.keys(rateCache?.entries || {}), ...Object.keys(rateFailures || {})])].filter(key => validPair(key) && (validEntry(rateCache?.entries?.[key]) || validFailure(rateFailures?.[key])));
}

function usableSnapshot(value, key) {
  if (!value || typeof value !== "object") return false;
  if (key === "tableCache") return value.rates?.USD === 1 && Object.keys(value.rates).length > 1 && Object.entries(value.rates).every(([code, rate]) => SteamFX.isCurrency(code) && SteamFX.positiveRate(rate));
  return value.pairs && Object.keys(value.pairs).length > 0 && Object.entries(value.pairs).every(([pair, row]) => validPair(pair) && SteamFX.positiveRate(row?.rate) && typeof row.providerUpdatedAt === "string" && Number.isFinite(Date.parse(row.providerUpdatedAt)));
}

async function currentPair(target, epoch, free = false) {
  const settings = await settingsNow();
  return epoch === requestEpoch && isAutomatic(settings) && (free || settings.targetCurrency === target);
}

function failureRecord(error) {
  if (error.cachedFailure && validFailure(error.cachedFailure)) return {...error.cachedFailure};
  const at = Date.now();
  return {code: error.message, at, retryAt: Math.max(at + RETRY_DELAY, error.retryAt || 0), ...(Number.isInteger(error.status) ? {status: error.status} : {})};
}

function storedError(failure) {
  return Object.assign(new Error(failure.code), {retryAt: failure.retryAt, status: failure.status, cachedFailure: failure});
}

function unavailableHost(error) {
  return error.message === "NETWORK" && (!error.status || [401, 403, 408, 429, 451].includes(error.status) || error.status >= 500);
}

async function fetchText(url) {
  if (!isAutomatic(await settingsNow())) throw new Error("CANCELLED");
  const controller = new AbortController();
  controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal});
    if (!response.ok) {
      const error = new Error("NETWORK");
      error.status = response.status;
      const retryAfter = response.headers?.get("retry-after")?.trim();
      if (retryAfter) {
        const delay = /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(delay) && delay > 0) error.retryAt = Date.now() + delay;
      }
      throw error;
    }
    const text = await response.text();
    if (text.length > 2000000) throw new Error("FORMAT");
    if (controller.signal.reason?.message === "CANCELLED" || !isAutomatic(await settingsNow())) throw new Error("CANCELLED");
    return text;
  } catch (error) {
    if (error.message === "CANCELLED" || controller.signal.reason?.message === "CANCELLED" || !isAutomatic(await settingsNow())) throw new Error("CANCELLED");
    throw Object.assign(new Error(error.message === "FORMAT" ? "FORMAT" : "NETWORK"), {status: error.status, retryAt: error.retryAt});
  } finally {
    clearTimeout(timer);
    controllers.delete(controller);
  }
}

async function snapshot(cacheKey, failureKey, loader, force) {
  if (snapshotRequests.has(cacheKey)) return snapshotRequests.get(cacheKey);
  const task = (async () => {
    const stored = await chrome.storage.local.get([cacheKey, failureKey]);
    if (fresh(stored[cacheKey], force) && usableSnapshot(stored[cacheKey], cacheKey)) return stored[cacheKey];
    if (validFailure(stored[failureKey]) && stored[failureKey].retryAt > Date.now()) throw storedError(stored[failureKey]);
    try {
      const parsed = await loader();
      if (!isAutomatic(await settingsNow())) throw new Error("CANCELLED");
      const value = {...parsed, fetchedAt: Date.now()};
      await chrome.storage.local.set({[cacheKey]: value, [failureKey]: null});
      return value;
    } catch (error) {
      if (error.message !== "CANCELLED") await chrome.storage.local.set({[failureKey]: failureRecord(error)});
      throw error;
    }
  })();
  snapshotRequests.set(cacheKey, task);
  try {
    return await task;
  } finally {
    snapshotRequests.delete(cacheKey);
  }
}

async function obtainSteamCurrency(source, target, force) {
  const {steamCurrencyFailure, tableCache} = await chrome.storage.local.get(["steamCurrencyFailure", "tableCache"]);
  let blocked = validFailure(steamCurrencyFailure) && steamCurrencyFailure.retryAt > Date.now() ? steamCurrencyFailure : null;
  if (!blocked) {
    try {
      const url = new URL("https://steam-currency.ru/widget");
      url.searchParams.set("pair", `${source}:${target}`);
      url.searchParams.set("theme", "dark");
      const value = SteamFXSource.parseWidget(await fetchText(url.href), source, target);
      await chrome.storage.local.set({steamCurrencyFailure: null});
      return value;
    } catch (error) {
      if (error.message === "CANCELLED") throw error;
      if (unavailableHost(error)) {
        blocked = failureRecord(error);
        await chrome.storage.local.set({steamCurrencyFailure: blocked});
      }
    }
  }
  if (blocked && !(fresh(tableCache, force) && usableSnapshot(tableCache, "tableCache"))) throw storedError(blocked);
  let table;
  try {
    table = await snapshot("tableCache", "tableFailure", async () => SteamFXSource.parseTable(await fetchText("https://steam-currency.ru/")), force);
  } catch (error) {
    if (error.message === "FORMAT" || unavailableHost(error)) await chrome.storage.local.set({steamCurrencyFailure: failureRecord(error)});
    throw error;
  }
  return SteamFXSource.tablePair(table, source, target);
}

async function obtainPair(source, target, force) {
  try {
    return await obtainSteamCurrency(source, target, force);
  } catch (error) {
    if (error.message === "CANCELLED") throw error;
  }
  const rates = await snapshot("playwalletCache", "playwalletFailure", async () => {
    const text = await fetchText("https://steam-rates.playwallet.bot/latest-rate/");
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("FORMAT");
    }
    return SteamFXSource.parsePlayWallet(payload);
  }, force);
  return SteamFXSource.playWalletPair(rates, source, target);
}

function ensurePair(source, target, force, free = false) {
  const key = SteamFX.pairKey(source, target);
  const pending = inFlight.get(key);
  if (pending?.epoch === requestEpoch) return pending.task;
  const epoch = requestEpoch;
  const task = (async () => {
    const {rateCache, rateFailures} = await chrome.storage.local.get(["rateCache", "rateFailures"]);
    const entry = rateCache?.entries?.[key];
    const failure = rateFailures?.[key];
    const failed = validFailure(failure) && failure.version === 2 && (!validEntry(entry) || failure.at >= entry.fetchedAt);
    if (validEntry(entry) && fresh(entry, force) && !failed) return;
    if (failed && Date.now() < (force ? failure.at + REFRESH_COOLDOWN : failure.retryAt)) return;
    if (!await currentPair(target, epoch, free)) return;
    const operation = requestQueue.then(async () => {
      if (!await currentPair(target, epoch, free)) return;
      try {
        const result = await obtainPair(source, target, force || failed && validEntry(entry));
        if (!await currentPair(target, epoch, free)) return;
        const saved = await updateStored("rateCache", async value => await currentPair(target, epoch, free) ? {version: 1, entries: {...value?.entries, [key]: {...result, fetchedAt: result.fetchedAt || Date.now()}}} : undefined);
        if (!saved) return;
        await updateStored("rateFailures", value => {
          const next = {...value};
          delete next[key];
          return next;
        });
      } catch (error) {
        if (error.message === "CANCELLED" || !await currentPair(target, epoch, free)) return;
        await updateStored("rateFailures", value => ({...value, [key]: {...failureRecord(error), version: 2}}));
      }
    });
    requestQueue = operation.catch(() => {});
    await operation;
  })().finally(() => { if (inFlight.get(key) === request) inFlight.delete(key); });
  const request = {epoch, task};
  inFlight.set(key, request);
  return task;
}

async function refreshAlarm() {
  const {settings: raw, rateCache, rateFailures} = await chrome.storage.local.get(["settings", "rateCache", "rateFailures"]);
  const settings = SteamFX.normalizeSettings(raw);
  if (!isAutomatic(settings)) {
    await chrome.alarms.clear(ALARM);
    return;
  }
  const deadlines = activeKeys(rateCache, rateFailures).filter(key => key.endsWith(`:${settings.targetCurrency}`)).map(key => {
    const entry = rateCache?.entries?.[key];
    const failure = rateFailures?.[key];
    if (validFailure(failure) && (!validEntry(entry) || failure.at >= entry.fetchedAt)) return failure.version === 2 ? failure.retryAt : Date.now();
    return entry.fetchedAt + TTL;
  });
  if (deadlines.length) await chrome.alarms.create(ALARM, {when: Math.max(Date.now() + 60000, Math.min(...deadlines))});
  else await chrome.alarms.clear(ALARM);
}

function scheduleRefresh() {
  const task = alarmQueue.then(refreshAlarm);
  alarmQueue = task.catch(() => {});
  return task;
}

function updateSettings(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return Promise.reject(new Error("FORMAT"));
  const changes = Object.fromEntries(Object.entries(patch).filter(([key]) => Object.hasOwn(SteamFX.defaults, key)));
  return updateStored("settings", raw => {
    const settings = SteamFX.normalizeSettings(raw);
    const next = SteamFX.normalizeSettings({...settings, ...changes});
    if (next.targetCurrency !== settings.targetCurrency || next.manualSourceCurrency !== settings.manualSourceCurrency) next.manualRate = "";
    return next;
  });
}

async function loadState(sources, force = false) {
  const settings = await settingsNow();
  const requested = Array.isArray(sources) ? sources : [settings.manualSourceCurrency];
  const valid = [...new Set(requested)].filter(code => SteamFX.isCurrency(code) && code !== settings.targetCurrency).slice(0, Object.keys(SteamFX.currencies).length);
  if (isAutomatic(settings)) await Promise.all(valid.map(source => ensurePair(source, settings.targetCurrency, force)));
  const stored = await chrome.storage.local.get(["settings", "rateCache", "rateFailures"]);
  await scheduleRefresh();
  return {settings: SteamFX.normalizeSettings(stored.settings), rateCache: stored.rateCache || {version: 1, entries: {}}, rateFailures: stored.rateFailures || {}};
}

async function loadPairs(pairs, force = false) {
  const settings = await settingsNow();
  const requested = Array.isArray(pairs) ? pairs : [];
  const valid = [...new Set(requested.filter(pair => Array.isArray(pair) && pair.length === 2).map(([source, target]) => SteamFX.pairKey(source, target)))].filter(validPair).slice(0, SteamFX.calcLimit + 1);
  if (isAutomatic(settings)) await Promise.all(valid.map(key => ensurePair(...key.split(":"), force, true)));
  const stored = await chrome.storage.local.get(["settings", "rateCache", "rateFailures"]);
  return {settings: SteamFX.normalizeSettings(stored.settings), rateCache: stored.rateCache || {version: 1, entries: {}}, rateFailures: stored.rateFailures || {}};
}

function allowedSender(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  try {
    const url = new URL(sender.url || "");
    return (url.protocol === "chrome-extension:" && url.hostname === chrome.runtime.id) || (url.protocol === "https:" && ["store.steampowered.com", "steamcommunity.com"].includes(url.hostname));
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!allowedSender(sender) || !["GET_STATE", "REFRESH_RATES", "UPDATE_SETTINGS", "GET_PAIRS"].includes(message?.type)) return false;
  if (message.type !== "GET_STATE" && !sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return false;
  if (message.type === "UPDATE_SETTINGS") {
    updateSettings(message.patch).then(settings => respond({ok: true, settings})).catch(() => respond({ok: false, error: "STORAGE"}));
    return true;
  }
  if (message.type === "GET_PAIRS") {
    loadPairs(message.pairs, message.force === true).then(state => respond({ok: true, state})).catch(() => respond({ok: false, error: "STORAGE"}));
    return true;
  }
  loadState(message.sources, message.type === "REFRESH_RATES").then(state => respond({ok: true, state})).catch(() => respond({ok: false, error: "STORAGE"}));
  return true;
});

function iconImages() {
  iconBase ||= Promise.all(ICON_SIZES.map(async size => {
    const response = await fetch(chrome.runtime.getURL(`icons/${size}.png`));
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d", {willReadFrequently: true});
    context.drawImage(bitmap, 0, 0, size, size);
    bitmap.close();
    return [size, context.getImageData(0, 0, size, size).data];
  })).catch(error => {
    iconBase = null;
    throw error;
  });
  return iconBase;
}

async function applyIcon(settings) {
  const accent = SteamFXTheme.ensureReadable(settings.accentColor);
  const key = settings.enabled ? accent : "off";
  if (key === iconKey) return;
  if (settings.enabled && accent === SteamFXTheme.defaultColor) {
    await chrome.action.setIcon({path: Object.fromEntries(ICON_SIZES.map(size => [size, `icons/${size}.png`]))});
  } else {
    const images = await iconImages();
    const imageData = Object.fromEntries(images.map(([size, base]) => {
      const data = new Uint8ClampedArray(base);
      if (settings.enabled) SteamFXTheme.tintPixels(data, accent);
      else SteamFXTheme.grayPixels(data);
      return [size, new ImageData(data, size, size)];
    }));
    await chrome.action.setIcon({imageData});
  }
  iconKey = key;
}

function refreshIcon(settings) {
  const task = iconQueue.then(async () => applyIcon(settings || await settingsNow()));
  iconQueue = task.catch(() => {});
  return task;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  const settings = SteamFX.normalizeSettings(changes.settings.newValue);
  const previous = SteamFX.normalizeSettings(changes.settings.oldValue);
  refreshIcon(settings).catch(() => {});
  const changed = previous.enabled !== settings.enabled || previous.manualEnabled !== settings.manualEnabled || previous.targetCurrency !== settings.targetCurrency;
  if (changed) requestEpoch++;
  if (!isAutomatic(settings) || changed) for (const controller of controllers) controller.abort(new Error("CANCELLED"));
  scheduleRefresh().catch(() => {});
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== ALARM) return;
  chrome.storage.local.get(["rateCache", "rateFailures"]).then(stored => {
    const keys = activeKeys(stored.rateCache, stored.rateFailures);
    return settingsNow().then(settings => loadState(keys.filter(key => key.endsWith(`:${settings.targetCurrency}`)).map(key => key.split(":")[0])));
  }).catch(() => {});
});

function prunePairs(value, valid) {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => validPair(key) && valid(entry)));
}

chrome.runtime.onInstalled.addListener(() => {
  updateStored("rateCache", value => value?.entries ? {...value, entries: prunePairs(value.entries, validEntry)} : undefined).catch(() => {});
  updateStored("rateFailures", value => value && typeof value === "object" ? prunePairs(value, validFailure) : undefined).catch(() => {});
  updateStored("settings", SteamFX.normalizeSettings).then(() => {
    refreshIcon().catch(() => {});
    return scheduleRefresh();
  }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  refreshIcon().catch(() => {});
  scheduleRefresh().catch(() => {});
});

refreshIcon().catch(() => {});
