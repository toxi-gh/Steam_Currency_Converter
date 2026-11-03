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
        if (!group.element.isConnected || excluded(group.element) || !state.settings.enabled || pending.some(element => element.contains(group.element) || group.element.contains(element))) {
          if (group.element.isConnected) pending.push(group.element);
          restore(group);
        }
      }
      if (!state.settings.enabled) return;
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
      const stored = await chrome.storage.local.get(["settings", "rateCache", "rateFailures"]);
      if (version !== stateVersion) return;
      state = {settings: SteamFX.normalizeSettings(stored.settings), rateCache: stored.rateCache || {entries: {}}, rateFailures: stored.rateFailures || {}};
      ready = true;
      roots.add(document.body || document.documentElement);
      schedule();
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
      .box { box-sizing: border-box; width: max-content; max-width: min(310px, calc(100vw - 24px)); padding: 14px 16px; border: 1px solid #2e5467; border-radius: 13px; background: #101b2af5; color: #eff6ff; box-shadow: 0 12px 36px #0008; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .label { color: #65dfd2; text-transform: uppercase; font-size: 10px; font-weight: 700; letter-spacing: 1.2px; }
      .original { display: flex; flex-direction: column; gap: 3px; margin-top: 5px; font-size: 17px; font-weight: 650; overflow-wrap: anywhere; }
      .original s { color: #a2b4c9; font-size: 13px; font-weight: 500; text-decoration: line-through; }
      .original .current { color: #eff6ff; }
      .rate { margin-top: 7px; color: #a2b4c9; font-size: 11px; white-space: pre-line; }
      .note { margin-top: 5px; color: #e7bd78; font-size: 11px; }
      .note:empty { display: none; }
      @media (prefers-reduced-motion: no-preference) { .box { animation: appear .12s ease-out; } @keyframes appear { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } } }
    `;
    const box = document.createElement("div");
    box.className = "box";
    box.setAttribute("role", "tooltip");
    const label = document.createElement("div");
    label.className = "label";
    const original = document.createElement("div");
    original.className = "original";
    const rate = document.createElement("div");
    rate.className = "rate";
    const note = document.createElement("div");
    note.className = "note";
    box.append(label, original, rate, note);
    shadow.append(style, box);
    document.documentElement.append(host);
    return {host, label, original, rate, note};
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
    tooltip.label.textContent = t(prices.length > 1 ? "tipLabels" : "tipLabel");
    const hasDiscount = prices.some(match => match.kind === "original") && prices.some(match => match.kind === "current");
    tooltip.original.replaceChildren(...prices.flatMap((match, index) => {
      const price = document.createElement(hasDiscount && match.kind === "original" ? "s" : "span");
      price.className = match.kind;
      price.textContent = match.original.trim();
      if (hasDiscount) price.setAttribute("aria-label", `${t(match.kind === "original" ? "tipBefore" : "tipDiscounted")}: ${price.textContent}`);
      return index ? [document.createTextNode(" "), price] : [price];
    }));
    const seen = new Set();
    tooltip.rate.textContent = prices.filter(match => {
      if (!match.rate || seen.has(match.currency)) return false;
      seen.add(match.currency);
      return true;
    }).map(match => `1 ${match.currency} = ${SteamFX.formatRate(match.rate.rate, state.settings.language)} ${state.settings.targetCurrency}`).join("\n");
    const stale = prices.some(match => SteamFX.resolveRate(state, match.currency)?.stale);
    const manual = state.settings.manualEnabled;
    tooltip.note.textContent = stale ? t("tipStale") : manual ? t("tipManual") : "";
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
    if (area !== "local" || !["settings", "rateCache", "rateFailures"].some(key => key in changes)) return;
    if (changes.settings) requestedPairs.clear();
    scheduleStateRefresh();
  });

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== "PAGE_STATS") return false;
    const matches = [...groups.values()].filter(group => group.element.isConnected).flatMap(group => group.matches);
    respond({count: matches.length, currencies: [...new Set(matches.map(match => match.currency))]});
    return false;
  });

  tooltip = createTooltip();
  observer.observe(document.documentElement, observerOptions);
  refreshState();
})();
