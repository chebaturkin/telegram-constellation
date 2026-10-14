"""Regression for overlapping pointer targets and selection without layout loss."""
import json
import os
from playwright.sync_api import sync_playwright

PORT = os.environ.get('APP_PORT', '4175')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(locale="ru-RU", viewport={'width': 1440, 'height': 1000})
    page.goto(f'http://127.0.0.1:{PORT}/')
    page.wait_for_load_state('networkidle')
    dense = {'id': 'dense', 'name': 'проверка выбора', 'messages': [
        {'id': index, 'from': f'участник {index}', 'from_id': f'user{index}', 'date': '2026-06-01T12:00:00Z', 'text': ''}
        for index in range(50)
    ]}
    page.locator('#file-input').set_input_files({'name': 'dense.json', 'mimeType': 'application/json', 'buffer': json.dumps(dense).encode()})
    page.locator('.node').first.wait_for()
    page.locator('#atlas-svg').scroll_into_view_if_needed()
    for node in [page.locator('.node').first, page.locator('.node').nth(12), page.locator('.node').nth(25)]:
        expected_id = node.get_attribute('data-node-id')
        # Click the visual center, rather than dispatching an event to bypass hit testing.
        bounds = node.bounding_box()
        page.mouse.click(bounds['x'] + bounds['width'] / 2, bounds['y'] + bounds['height'] / 2)
        assert page.locator('.node.is-focus').get_attribute('data-node-id') == expected_id, f'center click must select {expected_id}'
        assert page.locator('#inspector').is_visible()
        page.locator('#close-selection').click()
    # A fresh page avoids DevTools retaining nodes inspected by bounding_box above.
    page.close()
    privacy_page = browser.new_page(locale="ru-RU", viewport={'width': 1440, 'height': 1000})
    privacy_page.goto(f'http://127.0.0.1:{PORT}/')
    privacy_page.wait_for_load_state('networkidle')
    privacy_page.evaluate("""() => {
        document.getElementById('open-demo').click();
        window.clearedNodeReference = new WeakRef(document.querySelector('.node'));
        document.getElementById('clear-data').click();
    }""")
    privacy_page.wait_for_timeout(900)
    session = privacy_page.context.new_cdp_session(privacy_page)
    session.send('Runtime.discardConsoleEntries')
    for _ in range(3):
        session.send('HeapProfiler.collectGarbage')
    assert privacy_page.evaluate('window.clearedNodeReference.deref() === undefined'), 'deleted data must not remain in detached SVG groups'
    browser.close()
print('Dense pointer selection passed: 50 nodes, exact visual centers, details open and close.')
