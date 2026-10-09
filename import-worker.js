import { parseExport } from './app-data.js';

// This worker has no network code. Only metadata comes back to the page.
self.onmessage = ({ data }) => {
  let lastPercent = -1;
  try {
    self.postMessage({ type: 'progress', label: 'разбираем JSON', percent: 0 });
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data.buffer);
    const model = parseExport(text, {
      onProgress: ({ phase, ratio }) => {
        if (phase !== 'normalizing') return;
        const percent = Math.floor(ratio * 100);
        if (percent === lastPercent) return;
        lastPercent = percent;
        self.postMessage({ type: 'progress', label: 'сводим сообщения и связи', percent });
      },
    });
    self.postMessage({ type: 'ready', model });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.userMessage || (error.name === 'TypeError' ? 'не удалось прочитать кодировку. выберите исходный UTF-8 JSON из Telegram Desktop.' : 'формат файла не распознан. выберите result.json из Telegram Desktop.') });
  }
};
