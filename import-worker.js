import { t, getLocale, localeTag, mountLocale, translateMessage, setLocale } from './i18n.js';
import { parseExport } from './app-data.js';

// This worker has no network code. Only metadata comes back to the page.
self.onmessage = ({ data }) => {
  setLocale(data.locale);
  let lastPercent = -1;
  try {
    self.postMessage({ type: 'progress', get label() { return t("s123"); }, percent: 0 });
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data.buffer);
    const model = parseExport(text, {
      onProgress: ({ phase, ratio }) => {
        if (phase !== 'normalizing') return;
        const percent = Math.floor(ratio * 100);
        if (percent === lastPercent) return;
        lastPercent = percent;
        self.postMessage({ type: 'progress', get label() { return t("s124"); }, percent });
      },
    });
    self.postMessage({ type: 'ready', model });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.userMessage || (error.name === 'TypeError' ? t("s125") : t("s126")) });
  }
};
