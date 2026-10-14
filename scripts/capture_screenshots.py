"""Capture the real interface using fictional data; run against the local server."""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs' / 'screenshots'
PORT = os.environ.get('APP_PORT', '4175')
OUTPUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(locale="ru-RU", viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    page.goto(f'http://127.0.0.1:{PORT}/')
    page.wait_for_load_state('networkidle')
    page.evaluate('document.fonts.ready')
    page.screenshot(path=str(OUTPUT / 'welcome.png'), full_page=True)
    page.locator('#open-demo').click()
    page.locator('.node').first.wait_for()
    page.locator('.node-row').filter(has_text='Мария').click()
    page.wait_for_timeout(800)
    page.evaluate("document.activeElement.blur(); window.scrollTo({top: 0, behavior: 'instant'})")
    page.screenshot(path=str(OUTPUT / 'atlas.png'), full_page=True)
    page.close()
    mobile = browser.new_page(locale="ru-RU", viewport={'width': 390, 'height': 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    mobile.goto(f'http://127.0.0.1:{PORT}/')
    mobile.wait_for_load_state('networkidle')
    mobile.locator('#open-demo').click()
    mobile.locator('.node').first.wait_for()
    mobile.locator('.node').filter(has=mobile.locator('title', has_text='Мария')).click()
    assert mobile.locator('#inspector').is_visible(), 'screenshot must show the real selected state'
    mobile.wait_for_timeout(800)
    mobile.evaluate("document.activeElement.blur(); window.scrollTo({top: 0, behavior: 'instant'})")
    mobile.screenshot(path=str(OUTPUT / 'mobile.png'), full_page=True)
    browser.close()
print('Screenshots saved to docs/screenshots: welcome.png, atlas.png, mobile.png')
