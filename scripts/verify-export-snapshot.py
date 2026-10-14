"""A language change cancels obsolete PNG decoding and permits a clean retry."""
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('APP_URL', 'http://127.0.0.1:4423/')

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(locale='en-US', accept_downloads=True)
    page = context.new_page()
    errors, downloads = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('download', lambda download: downloads.append(download))
    page.goto(URL.rstrip('/') + '/?lang=en', wait_until='networkidle')
    page.locator('#open-demo').click()
    page.locator('.node').first.wait_for()
    page.evaluate('''() => {
      window.exportSources = [];
      const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true, get: src.get, set(value) {
          exportSources.push(decodeURIComponent(value.split(',').slice(1).join(',')));
          setTimeout(() => src.set.call(this, value), 150);
        }
      });
    }''')
    page.locator('#export-png').evaluate('(node) => node.click()')
    page.wait_for_function('window.exportSources.length === 1')
    page.locator('[data-language="ru"]').evaluate('(node) => node.click()')
    expect(page.locator('html')).to_have_attribute('lang', 'ru')
    expect(page.locator('#export-png')).to_have_attribute('aria-busy', 'false')
    expect(page.locator('#node-list')).to_contain_text('Мария')
    page.wait_for_timeout(400)
    assert not downloads, 'an obsolete English PNG completed after the scene switched language'
    with page.expect_download() as download:
        page.locator('#export-png').click()
    assert download.value.suggested_filename == 'telegram-constellation.png'
    assert Path(download.value.path()).read_bytes().startswith(b'\x89PNG\r\n\x1a\n')
    sources = page.evaluate('window.exportSources')
    assert len(sources) == 2 and 'Maria' in sources[0] and not re.search('[а-яёА-ЯЁ]', sources[0])
    assert 'Мария' in sources[1] and 'Maria' not in sources[1]
    assert not errors, errors
    context.close()
    browser.close()
    print('constellation delayed image: locale switch cancels the obsolete PNG; retry exports the complete Russian scene')
