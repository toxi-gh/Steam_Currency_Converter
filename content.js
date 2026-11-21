(() => {
  "use strict";

  const PRICE_SELECTOR = [
    ".discount_final_price", ".discount_original_price", ".game_purchase_price", ".search_price",
    ".game_area_dlc_price", ".bundle_final_price", ".price", ".cart_total", ".cart_item_price",
    "[class*='price']", "[class*='Price']", "[itemprop='price']"
  ].join(",");
  const SKIP_SELECTOR = "script,style,noscript,textarea,input,select,option,svg,.discount_aria_label,[contenteditable='true'],[contenteditable='']";
  const ORIGINAL_PRICE_SELECTOR = ".discount_original_price,[class*='original_price'],[class*='OriginalPrice'],s,del,strike,[style*='line-through']";
  const FINAL_PRICE_SELECTOR = ".discount_final_price,.bundle_final_price";
  const DISCOUNT_SELECTOR = ".discount_prices,.discount_block,.game_purchase_discount,.search_price,[data-discount]";
  const FREE_PRICE_PATTERN = /^(?:бесплатно|free(?: to play)?)$/i;
  const PREVIEW_SELECTOR = "img,video,.capsule_hover_screenshots,.tab_screenshots_ctn,.screenshots";
  const ITEM_SELECTOR = "a[href*='/app/'],a[href*='/sub/'],a[href*='/bundle/'],a[href*='/market/listings/'],article,li,[itemscope],.search_result_row,.store_capsule,.market_listing_row,.cart_item,.game_area_purchase_game";
  const TRADE_SELECTOR = "#market_buynow_dialog,#market_buyorder_dialog,#market_sell_dialog,#market_removelisting_dialog,[id^='market_buynow_dialog_'],[id^='market_buyorder_dialog_'],[id^='market_sell_dialog_']";
  const FALLBACK_SKIP = ".review_box,.apphub_UserReviewCard,#user_reviews,#game_area_description,.game_description_snippet,[class*='Review'],[class*='review'],[class*='Title'],[class*='title'],h1,h2,h3,h4,h5,h6";
  const CURRENCY_ATTRIBUTES = ["data-currency", "data-currency-code", "data-currencycode"];
  const CURRENCY_SELECTOR = `meta[itemprop='priceCurrency'],meta[property='product:price:currency'],${CURRENCY_ATTRIBUTES.flatMap(name => [`html[${name}]`, `body[${name}]`]).join(",")}`;
  const observerOptions = {subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ["id", "class", "style", "hidden", ...CURRENCY_ATTRIBUTES, "content", "itemprop", "property"]};
  const groups = new Map();
  const owners = new WeakMap();
  const priceBindings = new WeakMap();
  const itemPrices = new WeakMap();
  const priceEntries = new Set();
  const sourceCache = new WeakMap();
  const roots = new Set();
  const requestedPairs = new Set();
  let state = {settings: SteamFX.normalizeSettings(), rateCache: {entries: {}}, rateFailures: {}};
  let ready = false;
  let welcome = null;
  let notice = null;
  let noticeLayer = null;
  let updateToast = null;
  let updateInfo = null;
  let noticeTimer = 0;
  let noticeClosed = "";
  let seenCurrency = "";
  let scheduled = false;
  let refreshScheduled = false;
  let stateVersion = 0;
  let tooltip = null;
  let hovered = null;
  let interaction = null;
  let hoverFrame = null;
  let sourceRevision = 0;
  let geometryRevision = 0;
  let retryTimer = null;
  const highlights = typeof Highlight === "function" && typeof CSS !== "undefined" && CSS.highlights ? {
    light: {original: new Highlight(), converted: new Highlight()},
    dark: {original: new Highlight(), converted: new Highlight()}
  } : null;

  if (highlights) {
    CSS.highlights.set("scl-original", highlights.light.original);
    CSS.highlights.set("scl-converted", highlights.light.converted);
    CSS.highlights.set("scl-original-dark", highlights.dark.original);
    CSS.highlights.set("scl-converted-dark", highlights.dark.converted);
  }

  function elementCurrency(element) {
    for (const attribute of CURRENCY_ATTRIBUTES) {
      const code = SteamFX.currencyFromValue(element.getAttribute(attribute));
      if (code) return code;
    }
    if (element.matches("meta[itemprop='priceCurrency'],meta[property='product:price:currency']")) return SteamFX.currencyFromValue(element.getAttribute("content"));
    return null;
  }

  function pageCurrency() {
    for (const element of document.querySelectorAll(CURRENCY_SELECTOR)) {
      if (element.tagName === "META" && element.closest("[itemscope]")) continue;
      const code = elementCurrency(element);
      if (code) return code;
    }
    return null;
  }

  function priceContext(element, context) {
    for (let owner = element; owner && owner !== document.body; owner = owner.parentElement) {
      const code = elementCurrency(owner);
      if (code) return {...context, pageCurrency: code};
      if (owner.hasAttribute("itemscope")) {
        const meta = owner.querySelector("meta[itemprop='priceCurrency']");
        const scoped = meta && elementCurrency(meta);
        if (scoped) return {...context, pageCurrency: scoped};
      }
    }
    return context;
  }

  function excluded(element) {
    return !element || element === tooltip?.host || tooltip?.host.contains(element) || Boolean(element.closest(`${SKIP_SELECTOR},${TRADE_SELECTOR}`));
  }

  function restoreCopyNodes(original, copy) {
    if (original.nodeType !== copy.nodeType) return;
    if (original.nodeType === Node.TEXT_NODE) {
      const item = owners.get(original)?.nodes.find(entry => entry.node === original);
      if (item && copy.data === item.rendered) copy.data = item.original;
      return;
    }
    if (original.nodeType === Node.ELEMENT_NODE && original.tagName !== copy.tagName) return;
    for (let index = 0; index < Math.min(original.childNodes.length, copy.childNodes.length); index++) restoreCopyNodes(original.childNodes[index], copy.childNodes[index]);
  }

  function restoreCopies(root) {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (!root.children.length && !root.id.endsWith("Copy")) return;
    const copies = [...root.querySelectorAll("[id$='Copy']")];
    if (root.matches("[id$='Copy']")) copies.unshift(root);
    for (const copy of copies) {
      if (!copy.closest(TRADE_SELECTOR)) continue;
      const original = document.getElementById(copy.id.slice(0, -4));
      if (original && original !== copy && !original.closest(TRADE_SELECTOR)) restoreCopyNodes(original, copy);
    }
  }

  function restore(group) {
    for (const match of group.matches) {
      if (match.ranges) for (const {highlight, range} of match.ranges) highlight.delete(range);
      match.ranges = null;
      const entry = match.entry;
      if (!entry) continue;
      priceEntries.delete(entry);
      for (const binding of entry.bindings) priceBindings.get(binding)?.delete(entry);
      if (entry.item) itemPrices.get(entry.item)?.delete(entry);
    }
    for (const item of group.nodes) {
      if (item.node.data === item.rendered) item.node.data = item.original;
      owners.delete(item.node);
    }
    groups.delete(group.element);
    sourceRevision++;
    geometryRevision++;
  }

  function priceAnchor(element, context, match) {
    const normalized = text => text.replace(/[\s\u200e\u200f\u061c]/g, "");
    const original = normalized(match.original);
    if (normalized(element.textContent) === original) return element;
    let anchor = element;
    for (let parent = element.parentElement; parent && !parent.matches("body,html,main"); parent = parent.parentElement) {
      if ([...parent.children].some(child => child !== anchor && !child.contains(anchor) && !child.textContent.trim())) break;
      const text = parent.textContent.trim();
      if (!text || text.length > 100) break;
      const matches = SteamFXPrices.findPrices(text, priceContext(parent, context));
      if (matches.length !== 1 || matches[0].start !== 0 || matches[0].end !== text.length) break;
      anchor = parent;
      if (normalized(text) === original) break;
    }
    return anchor;
  }

  function struckPrice(element) {
    let scope = element;
    for (let level = 0; level < 3 && scope.parentElement && !scope.parentElement.matches("body,html,main"); level++) scope = scope.parentElement;
    return priceKind(element, scope) === "original";
  }

  function textTone(element) {
    const channels = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(getComputedStyle(element).color);
    if (!channels) return "light";
    const [red, green, blue] = channels.slice(1, 4).map(value => {
      const channel = Number(value) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0.18 ? "dark" : "light";
  }

  function paintDual(matches, spans, entries) {
    if (!highlights) return;
    const nodes = new Map(entries.map(({node, index}) => [index, node]));
    for (const match of matches) {
      const span = spans.get(match);
      const node = span && nodes.get(span.part);
      if (!match.paired || !node || node.data.slice(span.start, span.end) !== match.value) continue;
      const split = span.end - match.converted.length;
      const tone = highlights[match.tone];
      const original = document.createRange();
      original.setStart(node, span.start);
      original.setEnd(node, split);
      const converted = document.createRange();
      converted.setStart(node, split);
      converted.setEnd(node, span.end);
      tone.original.add(original);
      tone.converted.add(converted);
      match.ranges = [{highlight: tone.original, range: original}, {highlight: tone.converted, range: converted}];
    }
  }

  function textNodes(element) {
    const result = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const button = node.parentElement.closest("button");
        const pricedButton = node.parentElement.closest(PRICE_SELECTOR)?.closest("button");
        return excluded(node.parentElement) || owners.has(node) || button && button !== pricedButton ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) result.push(walker.currentNode);
    return result;
  }

  function process(element, context, missing) {
    if (excluded(element) || !element.isConnected) return;
    const nodes = textNodes(element);
    const parts = [];
    const entries = [];
    let previousPrice = null;
    let offset = 0;
    for (const node of nodes) {
      const price = node.parentElement.closest(`${PRICE_SELECTOR},s,del,strike`);
      if (price && previousPrice && price !== previousPrice && !previousPrice.contains(node.parentElement) && parts.length && !/\s$/.test(parts[parts.length - 1]) && !/^\s/.test(node.data)) {
        parts.push(" ");
        offset++;
      }
      if (price && (!previousPrice || !price.contains(previousPrice))) previousPrice = price;
      entries.push({node, index: parts.length, start: offset});
      parts.push(node.data);
      offset += node.data.length;
    }
    const source = parts.join("");
    if (!source.trim() || source.length > 1000) return;
    const matches = SteamFXPrices.findPrices(source, priceContext(element, context));
    const replacements = [];
    for (const match of matches) {
      const owner = entries.find(item => match.numberStart >= item.start && match.numberStart < item.start + item.node.data.length);
      const local = owner && SteamFXPrices.findPrices(match.original, priceContext(owner.node.parentElement, context))[0];
      if (local) match.currency = local.currency;
      if (match.currency === state.settings.targetCurrency) continue;
      const rate = SteamFX.resolveRate(state, match.currency);
      if (!rate) {
        if (!state.settings.manualEnabled) missing.add(match.currency);
        continue;
      }
      const converted = SteamFX.formatMoney(match.amount * rate.rate, state.settings.targetCurrency, state.settings);
      const priceElement = owner?.node.parentElement || element;
      const paired = state.settings.dualPrices && !struckPrice(priceElement);
      const value = paired ? SteamFX.joinDual(match.original, converted) : converted;
      replacements.push({...match, value, converted, paired, tone: paired ? textTone(priceElement) : "light", rate, priceElement, displayNode: owner?.node, anchor: priceAnchor(priceElement, context, match)});
      if (rate.stale && !state.settings.manualEnabled) missing.add(match.currency);
    }
    if (!replacements.length) return;
    const {rendered, spans} = SteamFXPrices.renderParts(parts, replacements);
    const group = {element, matches: replacements, nodes: entries.map(({node, index}) => ({node, original: parts[index], rendered: rendered[index]}))};
    groups.set(element, group);
    for (const match of replacements) {
      const anchor = match.anchor;
      const item = anchor.closest(ITEM_SELECTOR);
      const bindings = [anchor];
      const parent = anchor.parentElement;
      if (parent?.matches("a") && parent.childElementCount === 1 && parent.firstElementChild === anchor) bindings.push(parent);
      const entry = {group, match, anchor, item, bindings, rectRevision: -1};
      match.entry = entry;
      priceEntries.add(entry);
      for (const binding of bindings) {
        if (!priceBindings.has(binding)) priceBindings.set(binding, new Set());
        priceBindings.get(binding).add(entry);
      }
      if (item) {
        if (!itemPrices.has(item)) itemPrices.set(item, new Set());
        itemPrices.get(item).add(entry);
      }
    }
    for (const item of group.nodes) {
      owners.set(item.node, group);
      if (item.node.data !== item.rendered) item.node.data = item.rendered;
    }
    paintDual(replacements, spans, entries);
    sourceRevision++;
    geometryRevision++;
  }

  function depth(element) {
    let count = 0;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) count++;
    return count;
  }

  function expandCandidate(element, context, texts) {
    const textOf = owner => {
      if (!texts.has(owner)) texts.set(owner, owner.textContent.trim());
      return texts.get(owner);
    };
    let result = element;
    for (let parent = element.parentElement, level = 0; parent && level < 3; parent = parent.parentElement, level++) {
      if (excluded(parent) || parent.closest(FALLBACK_SKIP)) break;
      const text = textOf(parent);
      const inner = textOf(result);
      if (!text || text.length > 1000) break;
      const matches = SteamFXPrices.findPrices(text, priceContext(element, context));
      if (matches.length === 1 && matches[0].start === 0 && matches[0].end === text.length && text.length > inner.length) result = parent;
      else if (text.startsWith(inner) && /^[\s\u200e\u200f\u061c]*[A-Z]{3}(?![\p{L}\p{N}_])/u.test(text.slice(inner.length))) {
        const prefix = document.createRange();
        prefix.selectNodeContents(parent);
        prefix.setEndBefore(result);
        if (prefix.toString().trim()) continue;
        const following = SteamFXPrices.findPrices(text.slice(inner.length).trim(), priceContext(parent, context));
        if (!following.length || following[0].start !== 0) return null;
      }
    }
    return result;
  }

  function standaloneCandidates(root, context, candidates) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (owners.has(node) || excluded(node.parentElement) || !SteamFXPrices.hasCurrency(node.data)) continue;
      for (let element = node.parentElement, level = 0; element && level < 3; element = element.parentElement, level++) {
        if (excluded(element) || element.closest(`${FALLBACK_SKIP},button`)) break;
        const text = element.textContent.trim();
        if (!text || text.length > 80) break;
        const matches = SteamFXPrices.findPrices(text, priceContext(element, context));
        if (matches.length === 1 && matches[0].start === 0 && matches[0].end === text.length) {
          candidates.add(element);
          break;
        }
      }
    }
  }

  function addRoot(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (excluded(element)) return;
    const owner = owners.get(node) || locateGroup(element);
    if (owner) return roots.add(owner.element);
    roots.add(element);
    const price = element.closest(PRICE_SELECTOR);
    if (price && price !== element && price.textContent.length <= 160) roots.add(price);
  }

  function collectMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === "childList") for (const node of mutation.addedNodes) restoreCopies(node);
      const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
      if (target === tooltip?.host || tooltip?.host.contains(target)) continue;
      if (excluded(target)) {
        if (target && !(mutation.type === "attributes" && ["style", "hidden"].includes(mutation.attributeName))) roots.add(target);
        continue;
      }
      if (mutation.type === "characterData") {
        const owner = owners.get(mutation.target);
        const item = owner?.nodes.find(entry => entry.node === mutation.target);
        if (item && mutation.target.data === item.rendered) continue;
      }
      if (mutation.type === "attributes" && ["class", "style", "hidden"].includes(mutation.attributeName)) {
        const relevant = boundPrices(target) || itemPrices.has(target) || target.matches(`${DISCOUNT_SELECTOR},body,html`) || hovered && (target.contains(hovered.element) || hovered.element.contains(target));
        if (relevant) invalidateTooltip();
        if (mutation.attributeName !== "class") continue;
      }
      if (mutation.type === "attributes" && mutation.attributeName === "class") {
        const wasPrice = /price/i.test(mutation.oldValue || "") || target.getAttribute("itemprop") === "price";
        if (wasPrice === target.matches(PRICE_SELECTOR)) continue;
      }
      if (mutation.type === "childList") {
        const changed = [...mutation.addedNodes, ...mutation.removedNodes];
        if (changed.length && changed.every(node => node.nodeType === Node.TEXT_NODE ? !node.data.trim() && !owners.has(node) : node.nodeType === Node.ELEMENT_NODE && node.matches("img,video,source,picture,svg"))) continue;
      }
      addRoot(mutation.target);
      if (mutation.type === "attributes" && [...CURRENCY_ATTRIBUTES, "content", "itemprop", "property"].includes(mutation.attributeName)) roots.add(document.body || document.documentElement);
      if (mutation.type === "childList") for (const node of mutation.addedNodes) addRoot(node);
    }
  }

  function flush() {
    scheduled = false;
    if (!ready) return;
    collectMutations(observer.takeRecords());
    const pending = [...roots].filter(element => element.isConnected);
    roots.clear();
    observer.disconnect();
    try {
      for (const group of [...groups.values()]) {
        if (!group.element.isConnected || excluded(group.element) || !active() || pending.some(element => element.contains(group.element) || group.element.contains(element))) {
          if (group.element.isConnected) pending.push(group.element);
          restore(group);
        }
      }
      if (!active()) return;
      const candidates = new Set();
      const context = {pageCurrency: pageCurrency()};
      for (const element of pending) {
        if (element.matches(PRICE_SELECTOR)) candidates.add(element);
        for (const candidate of element.querySelectorAll(PRICE_SELECTOR)) candidates.add(candidate);
        standaloneCandidates(element, context, candidates);
      }
      const missing = new Set();
      const texts = new WeakMap();
      const complete = [...new Set([...candidates].map(element => expandCandidate(element, context, texts)).filter(Boolean))];
      const candidatesByElement = new Set(complete);
      const combined = complete.filter(element => [...element.childNodes].some(node => {
        const code = node.textContent.replace(/[\s\u200e\u200f\u061c]/g, "");
        return /^[A-Z]{3}$/.test(code) && SteamFX.currencyFromValue(code) && candidatesByElement.has(node.previousElementSibling);
      }));
      const combinedSet = new Set(combined);
      const ordered = [...combined.sort((a, b) => depth(a) - depth(b)), ...complete.filter(element => !combinedSet.has(element)).sort((a, b) => depth(b) - depth(a))];
      for (const candidate of ordered) process(candidate, context, missing);
      requestRates(missing);
      scheduleNotice();
    } finally {
      if (ready) {
        observer.observe(document.documentElement, observerOptions);
        refreshTooltip(true);
      }
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  }

  function requestRates(currencies) {
    if (state.settings.manualEnabled || !state.settings.enabled) return;
    const sources = [...currencies].filter(code => !requestedPairs.has(SteamFX.pairKey(code, state.settings.targetCurrency)));
    if (!sources.length) return;
    for (const source of sources) requestedPairs.add(SteamFX.pairKey(source, state.settings.targetCurrency));
    (async () => {
      try {
        const response = await chrome.runtime.sendMessage({type: "GET_STATE", sources});
        if (!response?.ok) throw new Error("STORAGE");
        await refreshState();
      } catch (error) {
        if (!chrome.runtime.id || /Extension context invalidated/i.test(error.message)) return stop();
        for (const source of sources) requestedPairs.delete(SteamFX.pairKey(source, state.settings.targetCurrency));
        retryTimer ||= setTimeout(() => { retryTimer = null; scheduleStateRefresh(); }, 60000);
      }
    })();
  }

  function stop() {
    ready = false;
    observer.disconnect();
    clearTimeout(retryTimer);
    retryTimer = null;
    for (const group of [...groups.values()]) restore(group);
    roots.clear();
    dismissTooltip();
  }

  async function refreshState() {
    const version = ++stateVersion;
    try {
      const stored = await chrome.storage.local.get(["settings", "rateCache", "rateFailures", "updateInfo"]);
      if (version !== stateVersion) return;
      state = {settings: SteamFX.normalizeSettings(stored.settings), rateCache: stored.rateCache || {entries: {}}, rateFailures: stored.rateFailures || {}};
      updateInfo = stored.updateInfo || null;
      ready = true;
      renderWelcome();
      renderUpdate();
      roots.add(document.body || document.documentElement);
      schedule();
      scheduleNotice();
    } catch {
      if (version === stateVersion) stop();
    }
  }

  function scheduleStateRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    queueMicrotask(() => {
      refreshScheduled = false;
      refreshState();
    });
  }

  function createTooltip() {
    const host = document.createElement("steam-currency-lens-tooltip");
    const shadow = host.attachShadow({mode: "closed"});
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial !important; position: fixed !important; left: var(--scl-left, 0px) !important; top: var(--scl-top, 0px) !important; z-index: 2147483647 !important; pointer-events: none !important; display: none !important; }
      :host([data-visible]) { display: block !important; }
      .box { box-sizing: border-box; width: max-content; max-width: min(360px, calc(100vw - 24px)); padding: 6px 10px; border: 1px solid #2e5467; border-radius: 8px; background: #101b2af5; color: #eff6ff; box-shadow: 0 8px 24px #0008; font: 600 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-variant-numeric: tabular-nums; }
      .prices { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
      .prices > * { white-space: nowrap; }
      .prices s { color: #a2b4c9; font-size: 12px; font-weight: 500; text-decoration: line-through; }
      @media (prefers-reduced-motion: no-preference) { .box { animation: appear .12s ease-out; } @keyframes appear { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } } }
    `;
    const box = document.createElement("div");
    box.className = "box";
    box.setAttribute("role", "tooltip");
    const prices = document.createElement("div");
    prices.className = "prices";
    box.append(prices);
    shadow.append(style, box);
    document.documentElement.append(host);
    return {host, prices};
  }

  function locateGroup(target) {
    for (let element = target instanceof Element ? target : target?.parentElement; element; element = element.parentElement) {
      if (groups.has(element)) return groups.get(element);
    }
    return null;
  }

  function discountScope(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (excluded(element) || !visiblePrice(element, document.documentElement)) return null;
    const boundary = element.closest(ITEM_SELECTOR);
    const related = [...groups.values()].flatMap(owner => owner.matches);
    const describe = scope => {
      const prices = related.filter(match => scope.contains(match.priceElement) && !excluded(match.priceElement) && visiblePrice(match.priceElement, scope));
      const current = prices.filter(match => priceKind(match.priceElement, scope) === "current");
      const select = selector => {
        const elements = [...scope.querySelectorAll(selector)];
        if (scope.matches(selector)) elements.unshift(scope);
        return elements.filter(owner => !excluded(owner) && visiblePrice(owner, scope));
      };
      const hasOriginal = prices.some(match => priceKind(match.priceElement, scope) === "original") || select(ORIGINAL_PRICE_SELECTOR).length > 0;
      const finals = select(FINAL_PRICE_SELECTOR);
      const free = hasOriginal ? freePriceElements(scope).filter(owner => !finals.some(final => final.contains(owner))) : [];
      const currentCount = current.length + finals.filter(owner => !current.some(match => owner.contains(match.priceElement))).length + free.length;
      const cards = select(ITEM_SELECTOR).filter(owner => owner !== scope && !scope.contains(owner.parentElement?.closest(ITEM_SELECTOR)));
      return {prices, currentCount, hasOriginal, shared: cards.length > 1};
    };
    let anchor = element;
    let details;
    while (anchor && !anchor.matches("body,html,main")) {
      details = describe(anchor);
      if (details.prices.length) break;
      if (anchor === boundary) return null;
      anchor = anchor.parentElement;
    }
    if (!anchor || anchor.matches("body,html,main") || details.shared || details.currentCount > 1 || details.prices.length > 1 && !(details.hasOriginal && details.currentCount === 1)) return null;
    for (let scope = anchor; scope && !scope.matches("body,html,main"); scope = scope.parentElement) {
      const info = scope === anchor ? details : describe(scope);
      if (info.shared || info.currentCount > 1) break;
      if (info.hasOriginal && info.currentCount === 1) return scope;
      if (scope.matches(DISCOUNT_SELECTOR)) return scope;
      if (scope === boundary) break;
    }
    return anchor;
  }

  function originalContent(element) {
    const parts = [];
    const nodes = [];
    let offset = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (excluded(node.parentElement)) continue;
      const item = owners.get(node)?.nodes.find(entry => entry.node === node);
      const part = item && node.data === item.rendered ? item.original : node.data;
      nodes.push({node, start: offset, end: offset + part.length});
      parts.push(part);
      offset += part.length;
    }
    return {text: parts.join(""), nodes};
  }

  function priceKind(element, scope) {
    if (element.closest(FINAL_PRICE_SELECTOR)) return "current";
    if (element.closest(ORIGINAL_PRICE_SELECTOR)) return "original";
    for (let owner = element; owner && scope.contains(owner); owner = owner.parentElement) {
      const style = getComputedStyle(owner);
      if (`${style.textDecorationLine} ${style.textDecoration}`.includes("line-through")) return "original";
      if (style.position === "relative") {
        for (const pseudo of ["::before", "::after"]) {
          const line = getComputedStyle(owner, pseudo);
          if (!["\"\"", "''"].includes(line.content) || line.position !== "absolute" || line.display === "none" || line.visibility === "hidden") continue;
          if (!(parseFloat(line.borderBottomWidth) > 0 || parseFloat(line.borderTopWidth) > 0) || parseFloat(line.left) !== 0 || parseFloat(line.right) !== 0) continue;
          const height = owner.getBoundingClientRect().height || parseFloat(style.height);
          const middle = line.top.endsWith("%") ? parseFloat(line.top) / 100 : parseFloat(line.top) / height;
          if (middle >= 0.25 && middle <= 0.75) return "original";
        }
      }
      if (owner === scope) break;
    }
    return "current";
  }

  function visiblePrice(element, scope) {
    for (let owner = element; owner && scope.contains(owner); owner = owner.parentElement) {
      const style = getComputedStyle(owner);
      if (owner.hidden || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
      if (owner === scope) break;
    }
    return true;
  }

  function freePriceElements(scope) {
    return [scope, ...scope.querySelectorAll("*")].filter(element => !element.childElementCount && !excluded(element) && !element.closest(FALLBACK_SKIP) && FREE_PRICE_PATTERN.test(originalContent(element).text.trim()) && visiblePrice(element, scope));
  }

  function tooltipPrices(target, scope = discountScope(target)) {
    if (!scope) return {element: null, prices: []};
    const context = {pageCurrency: pageCurrency()};
    const collect = (selector, kind) => {
      const elements = [...scope.querySelectorAll(selector)];
      if (scope.matches(selector)) elements.unshift(scope);
      return elements.filter(element => !excluded(element) && visiblePrice(element, scope)).flatMap(element => {
        const content = originalContent(element);
        const text = content.text.trim();
        const matches = SteamFXPrices.findPrices(content.text, priceContext(element, context));
        if (!matches.length && kind === "current" && originals.length && FREE_PRICE_PATTERN.test(text)) return [{original: text, amount: 0, currency: originals[0].currency, kind, priceElement: element, rate: null}];
        return matches.map(match => {
          const owner = content.nodes.find(item => match.numberStart >= item.start && match.numberStart < item.end);
          const local = owner && SteamFXPrices.findPrices(match.original, priceContext(owner.node.parentElement, context))[0];
          const currency = local?.currency || match.currency;
          return {...match, currency, kind, priceElement: element, rate: SteamFX.resolveRate(state, currency)};
        });
      });
    };
    const originals = collect(ORIGINAL_PRICE_SELECTOR, "original");
    const current = collect(FINAL_PRICE_SELECTOR, "current");
    const matches = [...groups.values()].flatMap(owner => owner.matches).filter(match => scope.contains(match.priceElement) && visiblePrice(match.priceElement, scope)).map(match => ({...match, kind: priceKind(match.priceElement, scope)}));
    for (const match of matches) {
      const rows = match.kind === "original" ? originals : current;
      if (!rows.some(row => row.currency === match.currency && row.amount === match.amount)) rows.push(match);
    }
    if (originals.length && !current.length) {
      for (const element of freePriceElements(scope)) current.push({original: originalContent(element).text.trim(), amount: 0, currency: originals[0].currency, kind: "current", priceElement: element, rate: null});
    }
    const rows = originals.length && current.length ? [...originals, ...current] : matches;
    const seen = new Set();
    const prices = rows.filter(match => {
      const key = `${match.kind}:${match.currency}:${match.amount}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => Number(a.kind !== "original") - Number(b.kind !== "original"));
    return {element: scope, prices};
  }

  function showTooltip(group, target, scope, model) {
    if (!SteamFX.tooltipsActive(state.settings)) return;
    tooltip ||= createTooltip();
    const {element, prices} = model || tooltipPrices(target, scope);
    if (!prices.length) return hideTooltip();
    const t = key => SteamFXI18n.translate(state.settings.language, key);
    const hasDiscount = prices.some(match => match.kind === "original") && prices.some(match => match.kind === "current");
    tooltip.prices.replaceChildren(...prices.map(match => {
      const price = document.createElement(hasDiscount && match.kind === "original" ? "s" : "span");
      price.textContent = match.original.trim().replace(/\s+/g, "\u00a0");
      if (hasDiscount) price.setAttribute("aria-label", `${t(match.kind === "original" ? "tipBefore" : "tipDiscounted")}: ${price.textContent}`);
      return price;
    }));
    tooltip.host.setAttribute("data-visible", "");
    hovered = {group, element, revision: sourceRevision};
    positionTooltip();
  }

  function positionTooltip() {
    if (!hovered?.element.isConnected || !tooltip) return hideTooltip();
    const anchor = hovered.element.getBoundingClientRect();
    const box = tooltip.host.getBoundingClientRect();
    const left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - box.width / 2, window.innerWidth - box.width - 12));
    const top = anchor.bottom + box.height + 10 <= window.innerHeight ? anchor.bottom + 8 : Math.max(12, anchor.top - box.height - 8);
    tooltip.host.style.setProperty("--scl-left", `${left}px`);
    tooltip.host.style.setProperty("--scl-top", `${top}px`);
  }

  function hideTooltip() {
    tooltip?.host.removeAttribute("data-visible");
    hovered = null;
  }

  function dismissTooltip() {
    interaction = null;
    if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
    hoverFrame = null;
    hideTooltip();
  }

  function invalidateTooltip() {
    sourceRevision++;
    geometryRevision++;
    if (interaction) scheduleTooltip();
  }

  function boundPrices(target) {
    for (let element = target instanceof Element ? target : target?.parentElement; element; element = element.parentElement) {
      const entries = priceBindings.get(element);
      if (entries?.size) return entries;
    }
    return null;
  }

  function cachedSource(element, group) {
    const cached = sourceCache.get(element);
    if (cached?.revision === sourceRevision) return cached.source;
    const scope = discountScope(element);
    const owner = group || locateGroup(element) || [...priceEntries].find(entry => scope?.contains(entry.match.priceElement))?.group;
    const model = scope && owner ? tooltipPrices(element, scope) : null;
    const source = model?.prices.length ? {group: owner, target: element, scope, model} : null;
    sourceCache.set(element, {revision: sourceRevision, source});
    return source;
  }

  function tooltipSource(target, focus = false) {
    const element = target instanceof Element ? target : target?.parentElement;
    if (!element?.isConnected || excluded(element)) return null;
    const entries = boundPrices(element);
    if (entries) {
      for (const entry of entries) {
        const source = cachedSource(entry.anchor, entry.group);
        if (source) return source;
      }
    }
    if (focus && element.matches(ITEM_SELECTOR)) return cachedSource(element);
    if (element.matches(DISCOUNT_SELECTOR) || element.childElementCount < 2 && element.textContent.length <= 35 && FREE_PRICE_PATTERN.test(element.textContent.trim())) return cachedSource(element);
    return null;
  }

  function priceRects(entry) {
    if (entry.rectRevision === geometryRevision) return entry.rects;
    const node = entry.match.displayNode;
    const element = node?.parentElement;
    let rects = [];
    entry.visible = Boolean(node?.isConnected && node.data.trim() && !excluded(element) && visiblePrice(element, document.documentElement));
    if (entry.visible) {
      const range = document.createRange();
      range.selectNodeContents(node);
      if (typeof range.getClientRects === "function") rects = [...range.getClientRects()];
      if (!rects.length) rects.push(element.getBoundingClientRect());
    }
    entry.rects = rects.filter(rect => rect.width > 0 && rect.height > 0);
    entry.rectRevision = geometryRevision;
    return entry.rects;
  }

  function priceAtPoint(entry, x, y, target) {
    if (!entry.match.displayNode?.isConnected) return false;
    const rects = priceRects(entry);
    if (!rects.length) return Boolean(target && entry.visible && entry.anchor.contains(target));
    return rects.some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  }

  function sourceAtPoint(target, x, y) {
    const entries = boundPrices(target);
    if (entries) for (const entry of entries) if (priceAtPoint(entry, x, y, target)) return cachedSource(entry.anchor, entry.group);
    if (!(target instanceof Element) || !target.matches(`${DISCOUNT_SELECTOR},${FINAL_PRICE_SELECTOR}`) && !(target.childElementCount < 2 && target.textContent.length <= 35 && FREE_PRICE_PATTERN.test(target.textContent.trim()))) return null;
    const source = tooltipSource(target);
    if (!source) return null;
    const relevant = source.model.prices.map(price => price.entry).filter(Boolean);
    if (relevant.some(entry => priceAtPoint(entry, x, y, target))) return source;
    if (!relevant.length || relevant.every(entry => !priceRects(entry).length)) return source;
    const free = freePriceElements(source.scope).find(element => element === target || element.contains(target));
    return free ? source : null;
  }

  function pointerSource(force) {
    const {x, y, target: previous} = interaction;
    const candidate = force && typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) || previous : previous;
    const target = candidate instanceof Element ? candidate : candidate?.parentElement;
    if (excluded(target)) return null;
    const direct = sourceAtPoint(target, x, y);
    if (direct) return direct;
    const control = target.closest("button,[role='dialog'],[role='menu']");
    if (control || target.closest("#global_header,#global_header_content,#global_actions,.responsive_header") || !target.closest(PREVIEW_SELECTOR)) return null;
    const elements = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [];
    for (const element of elements) {
      const source = sourceAtPoint(element, x, y);
      if (source) return source;
    }
    const item = target.closest(ITEM_SELECTOR) || elements.map(element => element.closest(ITEM_SELECTOR)).find(element => element && itemPrices.has(element));
    const entries = item && itemPrices.get(item);
    if (!entries) return null;
    for (const entry of entries) {
      if (!priceAtPoint(entry, x, y)) continue;
      const source = cachedSource(entry.anchor, entry.group);
      if (source) return source;
    }
    return null;
  }

  function refreshTooltip(force = false) {
    if (!ready || !interaction || !SteamFX.tooltipsActive(state.settings)) return hideTooltip();
    const source = interaction.type === "pointer" ? pointerSource(force) : tooltipSource(interaction.target, true);
    if (!source) return hideTooltip();
    if (!force && hovered?.group === source.group && hovered.element === source.scope && hovered.revision === sourceRevision) return;
    showTooltip(source.group, source.target, source.scope, source.model);
  }

  function scheduleTooltip() {
    if (hoverFrame !== null) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = null;
      refreshTooltip();
    });
  }

  function pointerInteraction(event, target = event.target) {
    interaction = {type: "pointer", target, x: event.clientX, y: event.clientY};
  }

  const observer = new MutationObserver(mutations => {
    collectMutations(mutations);
    if (roots.size) schedule();
  });

  document.addEventListener("pointerover", event => {
    pointerInteraction(event);
    refreshTooltip();
  }, true);
  document.addEventListener("pointermove", event => {
    pointerInteraction(event);
    scheduleTooltip();
  }, true);
  document.addEventListener("pointerout", event => {
    if (!event.relatedTarget) return dismissTooltip();
    pointerInteraction(event, event.relatedTarget);
    refreshTooltip();
  }, true);
  document.addEventListener("focusin", event => {
    interaction = {type: "focus", target: event.target};
    refreshTooltip();
  }, true);
  document.addEventListener("focusout", () => { if (interaction?.type === "focus") dismissTooltip(); }, true);
  document.addEventListener("pointercancel", dismissTooltip, true);
  document.addEventListener("keydown", event => { if (event.key === "Escape") dismissTooltip(); }, true);
  window.addEventListener("scroll", () => { sourceRevision++; geometryRevision++; dismissTooltip(); }, true);
  window.addEventListener("resize", () => { sourceRevision++; geometryRevision++; dismissTooltip(); });
  document.fonts?.addEventListener("loadingdone", invalidateTooltip);
  window.addEventListener("blur", dismissTooltip);
  window.addEventListener("pageshow", scheduleStateRefresh);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleStateRefresh(); else dismissTooltip(); });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !["settings", "rateCache", "rateFailures", "updateInfo"].some(key => key in changes)) return;
    if (changes.settings) requestedPairs.clear();
    scheduleStateRefresh();
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "PAGE_STATS") return false;
    const matches = [...groups.values()].filter(group => group.element.isConnected).flatMap(group => group.matches);
    respond({count: matches.length, currencies: [...new Set(matches.map(match => match.currency))]});
    return false;
  });

  function active() {
    return state.settings.enabled && state.settings.termsAccepted;
  }

  function translateText(key, values) {
    return SteamFXI18n.translate(state.settings.language, key, values);
  }

  function themeColors() {
    const colors = SteamFXTheme.palette(state.settings.accentColor);
    return `--accent: ${colors["--accent"]}; --ink: ${colors["--accent-ink"]}; --from: ${colors["--card-from"]}; --to: ${colors["--card-to"]}; --border: ${colors["--card-border"]};`;
  }

  function overlayHost(name, css) {
    const host = document.createElement(name);
    const shadow = host.attachShadow({mode: "closed"});
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial !important; }
      * { box-sizing: border-box; margin: 0; }
      .surface { font: 400 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #eaf2fc; -webkit-font-smoothing: antialiased; }
      .mark { display: grid; flex-shrink: 0; place-items: center; border-radius: 12px; background: linear-gradient(145deg, var(--from), var(--to)); box-shadow: inset 0 0 0 1px var(--border); color: var(--accent); }
      .mark svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      button { font: inherit; cursor: pointer; }
      .primary { border: 0; border-radius: 10px; background: var(--accent); color: var(--ink); font-weight: 700; }
      .primary:hover { filter: brightness(1.06); }
      .secondary { border: 1px solid #ffffff1c; border-radius: 10px; background: #ffffff08; color: #dbe5f0; font-weight: 600; }
      .secondary:hover { background: #ffffff10; }
      button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      ${css}
    `;
    shadow.append(style);
    return {host, shadow};
  }

  function markIcon(size, path = "M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4") {
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.style.width = mark.style.height = `${size}px`;
    mark.innerHTML = `<svg width="${Math.round(size * .5)}" height="${Math.round(size * .5)}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    return mark;
  }

  function renderWelcome() {
    const visible = state.settings.enabled && !state.settings.termsAccepted;
    if (!visible) {
      welcome?.host.remove();
      welcome = null;
      return;
    }
    if (!welcome) {
      const {host, shadow} = overlayHost("steam-currency-lens-welcome", `
        :host { position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; display: block !important; }
        .backdrop { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; background: #070a11b8; backdrop-filter: blur(3px); }
        .card { width: min(500px, 100%); max-height: calc(100vh - 48px); overflow: auto; padding: 26px 26px 22px; border: 1px solid #ffffff17; border-radius: 18px; background: radial-gradient(ellipse at top right, color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%), #0f1623; box-shadow: 0 30px 80px #000c, 0 0 0 1px #0006; }
        .head { display: flex; align-items: center; gap: 14px; }
        h1 { font-size: 21px; font-weight: 700; line-height: 1.25; letter-spacing: -.2px; color: #f3f8ff; }
        .lead { margin-top: 14px; color: #c3cfdc; font-size: 14px; }
        .notice { margin-top: 16px; padding: 14px 16px; border: 1px solid #ffffff10; border-radius: 12px; background: #ffffff06; }
        h2 { color: #f3f8ff; font-size: 13.5px; font-weight: 650; }
        .notice p { margin-top: 6px; color: #9fb0c4; font-size: 12.5px; line-height: 1.6; }
        .primary { width: 100%; min-height: 44px; margin-top: 20px; padding: 10px 18px; font-size: 14px; }
        @media (prefers-reduced-motion: no-preference) { .card { animation: rise .2s ease-out; } @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.99); } } }
      `);
      const backdrop = document.createElement("div");
      backdrop.className = "backdrop surface";
      const card = document.createElement("section");
      card.className = "card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      card.setAttribute("aria-labelledby", "welcome-title");
      card.setAttribute("aria-describedby", "welcome-text");
      const head = document.createElement("div");
      head.className = "head";
      const title = document.createElement("h1");
      title.id = "welcome-title";
      head.append(markIcon(46), title);
      const lead = document.createElement("p");
      lead.className = "lead";
      lead.id = "welcome-text";
      const box = document.createElement("div");
      box.className = "notice";
      const noticeTitle = document.createElement("h2");
      const noticeText = document.createElement("p");
      box.append(noticeTitle, noticeText);
      const accept = document.createElement("button");
      accept.type = "button";
      accept.className = "primary";
      accept.addEventListener("click", () => {
        accept.disabled = true;
        chrome.runtime.sendMessage({type: "PAGE_ACTION", action: "accept"}).then(response => {
          if (!response?.ok) accept.disabled = false;
        }).catch(() => { accept.disabled = false; });
      });
      card.append(head, lead, box, accept);
      backdrop.append(card);
      shadow.append(backdrop);
      const block = event => event.preventDefault();
      backdrop.addEventListener("wheel", block, {passive: false});
      backdrop.addEventListener("touchmove", block, {passive: false});
      host.addEventListener("keydown", event => {
        if (event.key === "Tab") {
          event.preventDefault();
          accept.focus();
        }
        event.stopPropagation();
      });
      welcome = {host, backdrop, title, lead, noticeTitle, noticeText, accept};
      document.documentElement.append(host);
      requestAnimationFrame(() => accept.focus({preventScroll: true}));
    }
    welcome.backdrop.setAttribute("style", themeColors());
    welcome.backdrop.lang = state.settings.language;
    welcome.title.textContent = translateText("welcomeTitle");
    welcome.lead.textContent = translateText("welcomeText");
    welcome.noticeTitle.textContent = translateText("welcomeNoticeTitle");
    welcome.noticeText.textContent = translateText("welcomeNotice");
    welcome.accept.textContent = translateText("welcomeAccept");
  }

  function detectSteamCurrency() {
    const explicit = pageCurrency();
    if (explicit) return explicit;
    for (const wallet of document.querySelectorAll("#header_wallet_balance,#marketWalletBalanceAmount")) {
      const match = SteamFXPrices.findPrices(originalContent(wallet).text, {})[0];
      if (match) return match.currency;
    }
    const counts = new Map();
    let total = 0;
    for (const element of [...document.querySelectorAll(PRICE_SELECTOR)].slice(0, 80)) {
      if (excluded(element) || element.querySelector(PRICE_SELECTOR)) continue;
      for (const match of SteamFXPrices.findPrices(originalContent(element).text, priceContext(element, {}))) {
        counts.set(match.currency, (counts.get(match.currency) || 0) + 1);
        total++;
      }
    }
    const [code, count] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
    return code && count >= 2 && count / total >= 0.6 ? code : null;
  }

  function scheduleNotice() {
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(updateNotice, 900);
  }

  function noticeStack() {
    if (!noticeLayer) {
      const {host, shadow} = overlayHost("steam-currency-lens-notice", `
        :host { position: fixed !important; right: 20px !important; bottom: 20px !important; z-index: 2147483646 !important; display: block !important; }
        .stack { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
        .toast { display: flex; gap: 12px; width: min(384px, calc(100vw - 40px)); padding: 14px; border: 1px solid var(--border); border-radius: 14px; background: linear-gradient(140deg, var(--from), var(--to)), #0f1623; box-shadow: 0 18px 48px #000b, 0 0 0 1px #0006; }
        .body { flex: 1; min-width: 0; }
        h2 { color: #f3f8ff; font-size: 14px; font-weight: 650; line-height: 1.35; }
        p { margin-top: 4px; color: #b4c3d3; font-size: 12.5px; line-height: 1.5; }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .actions > * { display: inline-grid; place-items: center; min-width: 72px; height: 32px; padding: 0 13px; font-size: 13px; white-space: nowrap; text-decoration: none; }
        @media (prefers-reduced-motion: no-preference) { .toast { animation: slide .22s ease-out; } @keyframes slide { from { opacity: 0; transform: translateY(10px); } } }
      `);
      const stack = document.createElement("div");
      stack.className = "stack surface";
      shadow.append(stack);
      document.documentElement.append(host);
      noticeLayer = {host, stack};
    }
    return noticeLayer.stack;
  }

  function releaseNotices() {
    if (noticeLayer && !noticeLayer.stack.childElementCount) {
      noticeLayer.host.remove();
      noticeLayer = null;
    }
  }

  function createToast(id, primaryTag, path) {
    const toast = document.createElement("section");
    toast.className = "toast";
    toast.setAttribute("role", "alertdialog");
    toast.setAttribute("aria-labelledby", `${id}-title`);
    toast.setAttribute("aria-describedby", `${id}-text`);
    const body = document.createElement("div");
    body.className = "body";
    const title = document.createElement("h2");
    title.id = `${id}-title`;
    const text = document.createElement("p");
    text.id = `${id}-text`;
    const actions = document.createElement("div");
    actions.className = "actions";
    const primary = document.createElement(primaryTag);
    primary.className = "primary";
    const secondary = document.createElement("button");
    secondary.type = "button";
    secondary.className = "secondary";
    if (primaryTag === "button") primary.type = "button";
    actions.append(primary, secondary);
    body.append(title, text, actions);
    toast.append(markIcon(36, path), body);
    return {toast, title, text, primary, secondary};
  }

  function paintToast(item) {
    item.toast.setAttribute("style", themeColors());
    item.toast.lang = state.settings.language;
  }

  function hideNotice() {
    notice?.toast.remove();
    notice = null;
    releaseNotices();
  }

  function updateNotice() {
    if (!ready || !active()) return hideNotice();
    const steam = detectSteamCurrency();
    if (!steam) return;
    const settings = state.settings;
    if (steam !== seenCurrency) {
      seenCurrency = steam;
      chrome.runtime.sendMessage({type: "PAGE_ACTION", action: "seen", currency: steam}).catch(() => {});
    }
    const key = `${steam}:${settings.manualSourceCurrency}`;
    if (steam === settings.manualSourceCurrency) noticeClosed = "";
    if (steam === settings.manualSourceCurrency || steam === settings.targetCurrency || settings.promptMuted || noticeClosed === key) return hideNotice();
    showNotice(steam, key);
  }

  function showNotice(steam, key) {
    const source = state.settings.manualSourceCurrency;
    if (!notice) {
      notice = createToast("notice", "button");
      notice.primary.addEventListener("click", () => {
        noticeClosed = notice.key;
        chrome.runtime.sendMessage({type: "PAGE_ACTION", action: "switch", currency: notice.steam}).catch(() => {});
        hideNotice();
      });
      notice.secondary.addEventListener("click", () => {
        noticeClosed = notice.key;
        chrome.runtime.sendMessage({type: "PAGE_ACTION", action: "mute"}).catch(() => {});
        hideNotice();
      });
      noticeStack().append(notice.toast);
    }
    notice.steam = steam;
    notice.key = key;
    paintToast(notice);
    notice.title.textContent = translateText("promptTitle", {steam});
    notice.text.textContent = translateText("promptText", {steam: `${SteamFX.currencyName(steam, state.settings.language)} (${steam})`, source: `${SteamFX.currencyName(source, state.settings.language)} (${source})`});
    notice.primary.textContent = translateText("yes");
    notice.secondary.textContent = translateText("no");
  }

  function renderUpdate() {
    const current = chrome.runtime.getManifest().version;
    const status = SteamFX.updateStatus(updateInfo, current);
    if (!ready || !state.settings.termsAccepted || !status.notify) {
      updateToast?.toast.remove();
      updateToast = null;
      releaseNotices();
      return;
    }
    if (!updateToast) {
      updateToast = createToast("update", "a", "M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14");
      updateToast.primary.href = SteamFX.releasesUrl;
      updateToast.primary.target = "_blank";
      updateToast.primary.rel = "noopener noreferrer";
      updateToast.secondary.addEventListener("click", () => {
        updateToast.secondary.disabled = true;
        chrome.runtime.sendMessage({type: "PAGE_ACTION", action: "skipUpdate", version: updateToast.version}).then(response => {
          if (!response?.ok && updateToast) updateToast.secondary.disabled = false;
        }).catch(() => {
          if (updateToast) updateToast.secondary.disabled = false;
        });
      });
      noticeStack().prepend(updateToast.toast);
    }
    updateToast.version = status.latest;
    paintToast(updateToast);
    updateToast.title.textContent = translateText("updateTitle", {version: status.latest});
    updateToast.text.textContent = translateText("updateText", {current: status.current});
    updateToast.primary.textContent = translateText("updateOpen");
    updateToast.secondary.textContent = translateText("updateSkip");
  }

  tooltip = createTooltip();
  observer.observe(document.documentElement, observerOptions);
  refreshState();
})();
