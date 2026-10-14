from pathlib import Path
import os
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = os.environ.get('APP_PORT', '4175')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(locale="ru-RU", viewport={'width': 1440, 'height': 1000})
    errors, requests = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: requests.append(request.url))
    page.goto(f'http://127.0.0.1:{PORT}/')
    page.wait_for_load_state('networkidle')
    assert page.locator('#open-demo').count() == 1, 'first visit needs a working example'
    assert page.locator('h1').inner_text() == 'telegram constellation'
    assert not page.locator('#filters-panel').is_visible()
    page.locator('#open-help').click()
    assert page.locator('#help-dialog').is_visible()
    page.keyboard.press('Escape')
    assert not page.locator('#help-dialog').is_visible()
    page.locator('#open-demo').click()
    page.locator('.node').first.wait_for()
    assert page.locator('#demo-banner').is_visible()
    page.locator('#filters-panel > summary').click()
    assert page.locator('.node-row').count() >= 6
    map_top = page.locator('#atlas-svg').bounding_box()['y']
    page.locator('.node').first.dispatch_event('mouseenter')
    assert page.locator('#atlas-svg').bounding_box()['y'] == map_top, 'hover must not move the graph'
    page.locator('.node').first.dispatch_event('mouseleave')
    page.locator('#node-search').fill('Мария')
    assert page.locator('.node-row').count() == 1
    page.locator('.node-row').click()
    assert page.locator('#focus-title').inner_text() == 'Мария'
    assert page.locator('.node.is-focus').count() == 1
    page.locator('#close-selection').click()
    assert not page.locator('#inspector').is_visible()
    page.locator('#node-search').fill('нет такого имени')
    assert page.locator('#node-list-empty').is_visible()
    page.locator('#node-search').fill('')
    page.locator('#mode-chats').click()
    assert page.locator('#view-mode').input_value() == 'chats'
    page.locator('#mode-participants').click()
    assert page.locator('#view-mode').input_value() == 'participants'
    period = page.locator('.timeline-point').first
    period.focus()
    period.press('Enter')
    assert page.locator('#from-date').input_value()
    assert page.locator('#reset-filters').is_enabled()
    page.locator('#reset-filters').click()
    assert page.locator('#from-date').input_value() == ''
    page.locator('#clear-data').click()
    assert page.locator('#welcome').is_visible()
    assert not page.locator('#demo-banner').is_visible()
    assert page.locator('#node-search').input_value() == ''
    assert page.locator('#selection-status').text_content() == '', 'clear removes names from live region'
    assert 'Мария' not in page.locator('body').text_content(), 'clear removes selected names from all DOM text'
    assert page.locator('.node-row').count() == 0
    page.locator('#file-input').set_input_files(str(ROOT / 'fixtures/result-small.json'))
    page.locator('.node').first.wait_for()
    assert not page.locator('#demo-banner').is_visible()
    assert page.locator('.node-row').count() == 2
    for width in [320, 375, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'overflow at {width}px'
    assert not errors, errors
    page.locator('#clear-data').click()
    page.locator('#open-demo').click()
    page.locator('.node').first.wait_for()
    page.locator('#filters-panel').evaluate('(el) => { el.open = true; }')
    page.locator('#from-date').fill('2026-09-01')
    page.locator('#to-date').fill('2026-04-01')
    assert page.locator('#atlas-empty').is_visible()
    assert page.locator('#empty-reset').is_visible()
    assert page.locator('#export-svg').is_disabled()
    page.locator('#empty-reset').click()
    assert not page.locator('#atlas-empty').is_visible()
    for export_id, suffix in [('export-svg', '.svg'), ('export-png', '.png')]:
        with page.expect_download() as download_info:
            page.locator('#' + export_id).click()
        download = download_info.value
        assert download.suggested_filename.endswith(suffix)
        assert Path(download.path()).stat().st_size > 1000
    page.reload()
    assert page.locator('#welcome').is_visible()
    assert not page.locator('#demo-banner').is_visible()
    realistic = {'id': 'large', 'name': 'крупный пример', 'messages': [{'id': i, 'from': f'участник {i % 20}', 'from_id': f'person-{i % 20}', 'date': '2026-06-01T12:00:00Z', 'text': ''} for i in range(10000)]}
    page.set_viewport_size({'width': 320, 'height': 900})
    page.locator('#file-input').set_input_files({'name': 'large.json', 'mimeType': 'application/json', 'buffer': json.dumps(realistic).encode()})
    page.locator('#stat-messages').filter(has_text='10').wait_for()
    assert page.locator('#stat-nodes').inner_text() == '20'
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'large counts must fit a 320px screen'
    assert not errors, errors
    assert not any(not url.startswith(f'http://127.0.0.1:{PORT}/') and not url.startswith(('blob:', 'data:')) for url in requests), requests
    browser.close()
print('Redesign journeys passed: example, search, selection, layers, dates, deletion, import, responsive, privacy.')
