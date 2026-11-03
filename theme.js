(() => {
  "use strict";

  const defaultColor = "#62eed4";
  const presets = Object.freeze([
    Object.freeze({id: "green", color: "#62eed4"}),
    Object.freeze({id: "blue", color: "#5cb8ff"}),
    Object.freeze({id: "violet", color: "#a78bfa"}),
    Object.freeze({id: "pink", color: "#f472b6"}),
    Object.freeze({id: "coral", color: "#ff7b72"}),
    Object.freeze({id: "amber", color: "#ffb547"})
  ]);
  const minLuminance = 0.14;
  const valueFloor = 0.42;
  const tints = Object.freeze({
    "--glow": "#21483d",
    "--logo-glow": "#3eeed3",
    "--accent-ink": "#0c302b",
    "--card-border": "#315047",
    "--tint-arrow": "#5d807f",
    "--tint-equals": "#537c77",
    "--tint-status": "#afc5c2",
    "--tint-date": "#76948f",
    "--tint-icon": "#9fb9b5",
    "--tint-cache-icon": "#69bfb1",
    "--tint-cache-title": "#c2d7d2"
  });

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const wrapHue = hue => (hue % 360 + 360) % 360;

  function parseHex(value) {
    const text = String(value ?? "").trim().replace(/^#/, "").toLowerCase();
    const full = /^[0-9a-f]{3}$/.test(text) ? [...text].map(char => char + char).join("") : text;
    return /^[0-9a-f]{6}$/.test(full) ? `#${full}` : null;
  }

  function toRgb(hex) {
    const number = parseInt(hex.slice(1), 16);
    return [number >> 16 & 255, number >> 8 & 255, number & 255];
  }

  function toHex(rgb) {
    return `#${rgb.map(channel => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
  }

  function hueOf(r, g, b, max, delta) {
    if (!delta) return 0;
    const sector = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return wrapHue(sector * 60);
  }

  function rgbToHsv(rgb) {
    const [r, g, b] = rgb.map(channel => channel / 255);
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    return [hueOf(r, g, b, max, delta), max ? delta / max : 0, max];
  }

  function hsvToRgb(hue, saturation, value) {
    const channel = offset => {
      const k = (offset + wrapHue(hue) / 60) % 6;
      return (value - value * saturation * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
    };
    return [channel(5), channel(3), channel(1)];
  }

  function rgbToHsl(rgb) {
    const [r, g, b] = rgb.map(channel => channel / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;
    return [hueOf(r, g, b, max, delta), delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0, lightness];
  }

  function hslToRgb(hue, saturation, lightness) {
    const amount = saturation * Math.min(lightness, 1 - lightness);
    const channel = offset => {
      const k = (offset + wrapHue(hue) / 30) % 12;
      return (lightness - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
    };
    return [channel(0), channel(8), channel(4)];
  }

  function luminance(rgb) {
    const [r, g, b] = rgb.map(channel => {
      const value = clamp(channel / 255);
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function readable(hex) {
    return luminance(toRgb(hex)) >= minLuminance;
  }

  function chroma(hex) {
    const rgb = toRgb(hex);
    return (Math.max(...rgb) - Math.min(...rgb)) / 255;
  }

  function minValue(hue, saturation) {
    const target = minLuminance + 0.002;
    if (luminance(hsvToRgb(hue, saturation, 1)) < target) return Infinity;
    let low = 0;
    let high = 1;
    for (let step = 0; step < 18; step++) {
      const middle = (low + high) / 2;
      if (luminance(hsvToRgb(hue, saturation, middle)) >= target) high = middle;
      else low = middle;
    }
    return high;
  }

  function valueAt(y) {
    return 1 - clamp(y) * (1 - valueFloor);
  }

  function yAt(value) {
    return clamp((1 - value) / (1 - valueFloor));
  }

  function limitY(hue, x) {
    const value = minValue(hue, x);
    if (!Number.isFinite(value)) return -1;
    return value <= valueFloor ? 1 : (1 - value) / (1 - valueFloor);
  }

  function boundary(hue, samples = 96) {
    return Array.from({length: samples + 1}, (_, index) => {
      const x = index / samples;
      return [x, limitY(hue, x)];
    });
  }

  function project(hue, x, y, width = 1, height = 1, samples = 120) {
    x = clamp(x);
    y = clamp(y);
    const limit = limitY(hue, x);
    if (limit >= 0 && y <= limit) return [x, y];
    let best = [0, 0];
    let distance = Infinity;
    for (const [column, columnLimit] of boundary(hue, samples)) {
      if (columnLimit < 0) continue;
      const row = Math.min(y, columnLimit);
      const next = ((column - x) * width) ** 2 + ((row - y) * height) ** 2;
      if (next < distance) {
        distance = next;
        best = [column, row];
      }
    }
    return best;
  }

  function colorAt(hue, x, y) {
    let value = valueAt(y);
    let hex = toHex(hsvToRgb(hue, x, value));
    while (!readable(hex) && value < 1) {
      value = Math.min(1, value + 0.004);
      hex = toHex(hsvToRgb(hue, x, value));
    }
    return hex;
  }

  function ensureReadable(color) {
    const hex = parseHex(color) || defaultColor;
    if (readable(hex)) return hex;
    const [hue, saturation, value] = rgbToHsv(toRgb(hex));
    const [x, y] = project(hue, saturation, yAt(value));
    return colorAt(hue, x, y);
  }

  const base = (() => {
    const [hue] = rgbToHsl(toRgb(defaultColor));
    return {hue, chroma: chroma(defaultColor)};
  })();

  function palette(color) {
    const hex = ensureReadable(color);
    const [hue] = rgbToHsl(toRgb(hex));
    const amount = chroma(hex);
    const shift = amount ? hue - base.hue : 0;
    const ratio = Math.min(1.6, amount / base.chroma);
    const vars = {"--accent": hex};
    for (const [name, tint] of Object.entries(tints)) {
      if (hex === defaultColor) {
        vars[name] = tint;
        continue;
      }
      const [tintHue, tintSaturation, tintLightness] = rgbToHsl(toRgb(tint));
      vars[name] = toHex(hslToRgb(tintHue + shift, clamp(tintSaturation * ratio), tintLightness));
    }
    return vars;
  }

  const iconBase = (() => {
    const [, saturation, lightness] = rgbToHsl(toRgb(defaultColor));
    return {saturation, lightness};
  })();

  function hueDistance(from, to) {
    return ((to - from) % 360 + 540) % 360 - 180;
  }

  function tintPixels(data, color) {
    const hex = ensureReadable(color);
    if (hex === defaultColor) return data;
    const [hue, saturation, lightness] = rgbToHsl(toRgb(hex));
    const shift = saturation ? hueDistance(base.hue, hue) : 0;
    const saturationRatio = saturation / iconBase.saturation;
    const lightnessRatio = lightness / iconBase.lightness;
    for (let index = 0; index < data.length; index += 4) {
      if (!data[index + 3]) continue;
      const pixel = [data[index], data[index + 1], data[index + 2]];
      const [pixelHue, pixelSaturation, pixelLightness] = rgbToHsl(pixel);
      const distance = Math.abs(hueDistance(base.hue, pixelHue));
      const weight = Math.max(clamp((25 - distance) / 10), clamp((42 - distance) / 12) * clamp((pixelLightness - 0.2) / 0.12)) * clamp(pixelSaturation / 0.2);
      if (!weight) continue;
      const rgb = hslToRgb(pixelHue + shift, clamp(pixelSaturation * saturationRatio), clamp(pixelLightness * lightnessRatio));
      for (let channel = 0; channel < 3; channel++) data[index + channel] = pixel[channel] + (rgb[channel] - pixel[channel]) * weight;
    }
    return data;
  }

  function grayPixels(data) {
    for (let index = 0; index < data.length; index += 4) {
      const gray = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
      data[index] = gray;
      data[index + 1] = gray;
      data[index + 2] = gray;
    }
    return data;
  }

  function apply(root, color) {
    const vars = palette(color);
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    return vars["--accent"];
  }

  globalThis.SteamFXTheme = Object.freeze({defaultColor, presets, valueFloor, parseHex, toRgb, toHex, rgbToHsv, hsvToRgb, readable, boundary, project, colorAt, yAt, ensureReadable, palette, apply, tintPixels, grayPixels});
})();
