(() => {
  "use strict";

  const ru = {
    subtitle: "Цены в понятной валюте", language: "Язык интерфейса", enabled: "Включить пересчёт цен",
    prices: "Цены", settings: "Настройки", internalRate: "Внутренний курс Steam", automatic: "Автоматически", manual: "Вручную",
    from: "Курс для", to: "Показать в", refresh: "Обновить курс", fetching: "Получаем курс…", unavailable: "Курс пока недоступен",
    cached: "Проверено {time}", providerDate: "Курс сайта: {date}", stale: "Сохранённый курс", staleHint: "Обновление недоступно. Используем последний курс.",
    networkError: "Источники недоступны. Повторим запрос позже.", formatError: "Не удалось прочитать курс. Попробуйте ручной режим.",
    pairError: "Источники не возвращают эту пару. Задайте курс вручную.", storageError: "Не удалось прочитать или сохранить данные расширения.",
    manualToggle: "Установить курс вручную", manualHint: "Автоматическое обновление отключится", manualUnit: "За 1 {source} в {target}",
    manualOnly: "Ручной курс применяется только к {source} → {target}.", validRate: "Введите положительный курс, например 0,1871.",
    calculator: "Быстрый расчёт", amount: "Сумма", result: "Результат", precision: "Знаков после запятой", precisionHint: "Округление цен на странице",
    autoDigits: "По валюте",
    tooltips: "Оригинал при наведении", tooltipsHint: "Исходная цена и использованный курс", tooltipsOff: "Отключено при двойном отображении",
    dual: "Двойное отображение цен", dualHint: "Исходная и переведённая цена рядом", cacheTitle: "Кэш на 6 часов",
    cacheHint: "Курсы сохраняются локально. Новые цены пересчитываются сразу.", source: "Источник курса", converted: "Пересчитано цен: {count}",
    openSteam: "Откройте магазин или торговую площадку Steam", paused: "Пересчёт приостановлен", footer: "Оценка стоимости. Валюта оплаты Steam не меняется.",
    steamCurrency: "SteamCurrency", playwallet: "PlayWallet", noRate: "Укажите курс",
    theme: "Цвет темы", themeHint: "Фон всегда тёмный", customColor: "Свой цвет", done: "Готово", hue: "Оттенок",
    saturation: "Насыщенность и яркость", svValue: "Насыщенность {s}%, яркость {v}%", hex: "Код цвета",
    tooDark: "Слишком тёмный для тёмного фона — цвет осветлён", colorGreen: "Зелёный", colorBlue: "Голубой", colorViolet: "Фиолетовый",
    colorPink: "Розовый", colorCoral: "Коралловый", colorAmber: "Янтарный"
  };
  const en = {
    subtitle: "Prices in your currency", language: "Interface language", enabled: "Enable price conversion",
    prices: "Prices", settings: "Settings", internalRate: "Steam exchange rate", automatic: "Automatic", manual: "Manual",
    from: "Rate for", to: "Display in", refresh: "Refresh rate", fetching: "Fetching rate…", unavailable: "Rate not available yet",
    cached: "Checked {time}", providerDate: "Provider rate: {date}", stale: "Saved rate", staleHint: "Update unavailable. Using the last saved rate.",
    networkError: "Providers unavailable. Retrying later.", formatError: "Could not read the rate. Try manual mode.",
    pairError: "Neither provider returns this pair. Set a manual rate.", storageError: "Could not read or save extension data.",
    manualToggle: "Set rate manually", manualHint: "Automatic updates will be paused", manualUnit: "Per 1 {source}, in {target}",
    manualOnly: "The manual rate only applies to {source} → {target}.", validRate: "Enter a positive rate, for example 0.1871.",
    calculator: "Quick calculator", amount: "Amount", result: "Result", precision: "Decimal places", precisionHint: "Rounding for prices on the page",
    autoDigits: "Currency default",
    tooltips: "Original price on hover", tooltipsHint: "Original price and the rate used", tooltipsOff: "Off while dual display is on",
    dual: "Dual price display", dualHint: "Original and converted price side by side", cacheTitle: "Cached for 6 hours",
    cacheHint: "Rates are saved locally. New prices are converted instantly.", source: "Rate provider", converted: "Prices converted: {count}",
    openSteam: "Open the Steam store or Community Market", paused: "Conversion paused", footer: "A price estimate. Your Steam payment currency stays the same.",
    steamCurrency: "SteamCurrency", playwallet: "PlayWallet", noRate: "Enter a rate",
    theme: "Theme color", themeHint: "Background stays dark", customColor: "Custom color", done: "Done", hue: "Hue",
    saturation: "Saturation and brightness", svValue: "Saturation {s}%, brightness {v}%", hex: "Color code",
    tooDark: "Too dark for the dark background, so it was lightened", colorGreen: "Green", colorBlue: "Blue", colorViolet: "Violet",
    colorPink: "Pink", colorCoral: "Coral", colorAmber: "Amber"
  };

  function translate(language, key, values = {}) {
    let text = (language === "en" ? en : ru)[key] || key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
    return text;
  }

  globalThis.SteamFXI18n = Object.freeze({translate});
})();
