"""Run against the local static server: APP_PORT=4175 python3 scripts/exploration_test.py."""
import json
import os
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = os.environ.get('APP_PORT', '4175')
ORIGIN = f'http://127.0.0.1:{PORT}/'
TYPES = ['reply', 'mention', 'shared', 'time']
ARCHIVE = {'name': 'Test archive', 'messages': [
    {'id': 1, 'from': 'Name_A', 'from_id': 'a', 'date': '2026-04-02T10:00:00', 'text': 'PRIVATE_BODY'},
    {'id': 2, 'from': 'Name_B', 'from_id': 'b', 'date': '2026-04-02T10:01:00', 'reply_to_message_id': 1, 'text': 'PRIVATE_BODY'},
    {'id': 3, 'from': 'Name_C', 'from_id': 'c', 'text': 'PRIVATE_BODY'},
    {'id': 4, 'from': 'Name_A', 'from_id': 'a', 'date': '2026-05-02T10:00:00', 'text': 'PRIVATE_BODY'},
    None,
]}


class ExplorationJourneys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 1440, 'height': 1000})
        self.page.set_default_timeout(15000)
        self.errors, self.requests = [], []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.on('request', lambda request: self.requests.append(request.url))
        self.page.goto(ORIGIN)
        self.page.wait_for_load_state('networkidle')

    def tearDown(self):
        self.page.close()
        self.assertFalse(self.errors)
        self.assertFalse([url for url in self.requests if not url.startswith((ORIGIN, 'blob:', 'data:'))])

    def upload(self):
        self.page.locator('#file-input').set_input_files({
            'name': 'test.json', 'mimeType': 'application/json',
            'buffer': json.dumps(ARCHIVE).encode(),
        })
        self.page.locator('.node').first.wait_for()
        self.page.wait_for_function("document.querySelector('#dataset-label').textContent.includes('test.json')")
        self.open_filters()

    def open_filters(self):
        panel = self.page.locator('#filters-panel')
        if panel.get_attribute('open') is None:
            panel.locator('summary').click()

    def test_relation_selection_controls_map_details_export_and_empty_state(self):
        page = self.page
        page.locator('#open-demo').click()
        page.locator('.node').first.wait_for()
        self.open_filters()
        self.assertEqual(page.locator('[data-relation-type]').count(), 4)
        before_nodes = page.locator('.node').count()
        before_messages = page.locator('#stat-messages').inner_text()
        page.locator('[data-relation-type="shared"]').uncheck()
        page.locator('[data-relation-type="time"]').uncheck()
        self.assertEqual(page.locator('.edge--shared, .edge--time').count(), 0)
        self.assertEqual(page.locator('.node').count(), before_nodes)
        self.assertEqual(page.locator('#stat-messages').inner_text(), before_messages)
        self.assertEqual(int(page.locator('#stat-relations').inner_text()), page.locator('.edge').count())
        page.locator('.node-row').first.click()
        self.assertNotIn('общие чаты', page.locator('#relation-breakdown').inner_text())
        self.assertNotIn('близость по времени', page.locator('#related-nodes').inner_text())
        with page.expect_download() as download:
            page.locator('#export-svg').click()
        svg = Path(download.value.path()).read_text()
        root = ET.fromstring(svg)
        lines = [node for node in root.iter() if node.tag.endswith('line') and 'edge' in node.get('class', '').split()]
        self.assertEqual(len(lines), page.locator('.edge').count())
        self.assertTrue(all(node.get('class') in ['edge edge--reply', 'edge edge--mention'] for node in lines))
        self.assertNotIn('data-source', svg)
        with page.expect_download() as download:
            page.locator('#export-png').click()
        self.assertTrue(Path(download.value.path()).read_bytes().startswith(b'\x89PNG\r\n\x1a\n'))
        page.locator('[data-relation-type="reply"]').uncheck()
        page.locator('[data-relation-type="mention"]').uncheck()
        self.assertEqual(page.locator('.edge').count(), 0)
        self.assertEqual(page.locator('.node').count(), before_nodes)
        page.locator('#relations-only').check()
        self.assertEqual(page.locator('.node').count(), 0)
        self.assertTrue(page.locator('#atlas-empty').is_visible())
        self.assertIn('тип', page.locator('#atlas-empty-copy').inner_text())
        self.assertTrue(page.locator('#export-svg').is_disabled())
        page.locator('#empty-reset').click()
        self.assertEqual(page.locator('[data-relation-type]:checked').count(), 4)
        self.assertEqual(page.locator('.node').count(), before_nodes)
        page.locator('#mode-chats').click()
        self.assertEqual(page.get_by_label('общие участники', exact=True).count(), 1)
        page.locator('.node-row').first.click()
        page.locator('#related-nodes summary').click()
        self.assertIn('общие участники', page.locator('#related-nodes').inner_text())
        page.locator('[data-relation-type="shared"]').uncheck()
        self.assertEqual(page.locator('.edge--shared').count(), 0)
        self.upload()
        self.assertEqual(page.locator('[data-relation-type]:checked').count(), 4)

    def test_neighbor_navigation_is_keyboard_accessible_and_respects_the_slice(self):
        self.upload()
        page = self.page
        self.assertFalse(page.locator('#related-nodes').is_visible())
        for kind in ['shared', 'time']:
            checkbox = page.locator(f'[data-relation-type="{kind}"]')
            checkbox.focus()
            checkbox.press('Space')
            self.assertFalse(checkbox.is_checked())
        row = page.locator('.node-row[data-node-id="a"]')
        row.focus()
        row.press('Enter')
        page.locator('#related-nodes summary').click()
        neighbors = page.locator('#related-nodes button')
        self.assertEqual(neighbors.count(), 1)
        self.assertIn('Name_B', neighbors.first.inner_text())
        self.assertIn('ответы: 1', neighbors.first.inner_text())
        page.locator('#related-nodes summary').focus()
        page.locator('.node[data-node-id="c"]').dispatch_event('mouseenter')
        self.assertEqual(page.locator('#focus-title').inner_text(), 'Name_A')
        self.assertEqual(page.evaluate('document.activeElement.id'), 'related-heading')
        self.assertEqual(neighbors.count(), 1, 'hover must preserve pinned details')
        page.locator('.node[data-node-id="c"]').dispatch_event('mouseleave')
        neighbors.first.focus()
        neighbors.first.press('Enter')
        self.assertEqual(page.locator('#focus-title').inner_text(), 'Name_B')
        self.assertEqual(page.evaluate('document.activeElement.id'), 'focus-title')
        self.assertIsNotNone(page.locator('#related-nodes details').get_attribute('open'))
        self.assertEqual(page.locator('.node.is-focus').get_attribute('data-node-id'), 'b')
        page.locator('#to-date').fill('2026-05-02')
        page.locator('#from-date').fill('2026-05-02')
        page.locator('#from-date').dispatch_event('change')
        page.locator('.node-row').first.click()
        self.assertEqual(neighbors.count(), 0)
        self.assertIn('нет связанных', page.locator('#related-nodes').inner_text())
        page.locator('#focus-title').press('Escape')
        self.assertFalse(page.locator('#related-nodes').is_visible())

    def test_new_controls_fit_small_screens_and_reduced_motion(self):
        self.upload()
        page = self.page
        page.emulate_media(reduced_motion='reduce')
        row = page.locator('.node-row[data-node-id="a"]')
        row.focus()
        row.press('Enter')
        summary = page.locator('#related-nodes summary')
        summary.focus()
        summary.press('Space')
        for width in [320, 375, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 1000})
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'overflow at {width}px')
            self.assertTrue(page.locator('#related-nodes button').first.is_visible())
            checkbox = page.locator('[data-relation-type="shared"]')
            checkbox.focus()
            checkbox.press('Space')
            self.assertFalse(checkbox.is_checked())
            checkbox.press('Space')
            self.assertTrue(checkbox.is_checked())
        self.assertEqual(page.evaluate("document.getAnimations().filter(a => a.playState === 'running').length"), 0)

    def test_diagnostics_explain_the_archive_and_survive_failed_replacement(self):
        self.assertFalse(self.page.locator('#import-notes').is_visible())
        self.upload()
        page = self.page
        notes = page.locator('#import-notes').inner_text()
        self.assertIn('1 сообщение без корректной даты', notes)
        self.assertIn('1 повреждённая запись', notes)
        self.assertNotIn('PRIVATE_BODY', page.content())
        page.locator('.timeline-point').first.click()
        self.assertEqual(page.locator('#stat-messages').inner_text(), '2')
        self.assertEqual(page.locator('#import-notes').inner_text(), notes)
        page.locator('#file-input').set_input_files(str(ROOT / 'fixtures/result-invalid.json'))
        page.locator('#status.is-error').wait_for()
        self.assertEqual(page.locator('#import-notes').inner_text(), notes)
        page.locator('#file-input').set_input_files(str(ROOT / 'fixtures/result-small.json'))
        page.wait_for_function("document.querySelector('#dataset-label').textContent.includes('result-small.json')")
        self.assertFalse(page.locator('#import-notes').is_visible())

    def test_deletion_removes_selected_names_from_the_entire_dom(self):
        self.upload()
        page = self.page
        page.locator('.node-row[data-node-id="a"]').click()
        self.assertIn('Name_A', page.locator('#selection-status').inner_text())
        page.locator('#clear-data').click()
        for name in ['Name_A', 'Name_B', 'Name_C']:
            self.assertFalse(name in page.content(), 'deletion must remove selected names from the entire DOM')
        self.assertEqual(page.locator('#selection-status').inner_text(), '')
        self.assertEqual(page.locator('#related-nodes').inner_text(), '')
        self.assertEqual(page.locator('#import-notes').inner_text(), '')


if __name__ == '__main__':
    unittest.main(verbosity=2)
