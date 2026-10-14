"""Interaction regressions for motion; run against the existing static server."""
import os
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = f"http://127.0.0.1:{os.environ.get('APP_PORT', '4175')}/"


class MotionJourneys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page(locale="ru-RU", viewport={"width": 1440, "height": 1000})
        self.page.goto(URL)
        self.page.wait_for_load_state("networkidle")
        self.page.locator("#open-demo").click()
        self.page.locator(".node").first.wait_for()
        self.page.wait_for_timeout(750)

    def tearDown(self):
        self.page.close()

    def test_filter_keeps_surviving_points_and_keyboard_focus(self):
        self.page.evaluate("""() => {
          window.savedNode = document.querySelector('.node');
          window.savedCoordinates = [savedNode.getAttribute('cx'), savedNode.getAttribute('cy')];
          savedNode.focus();
          const select = document.querySelector('#person-filter');
          select.value = savedNode.dataset.nodeId;
          select.dispatchEvent(new Event('change'));
        }""")
        self.assertTrue(self.page.evaluate("savedNode.isConnected"), "filters should retain the same node")
        self.assertTrue(self.page.evaluate("document.activeElement === savedNode"), "filtering lost keyboard focus")
        self.assertEqual(self.page.evaluate("[savedNode.getAttribute('cx'), savedNode.getAttribute('cy')]"),
                         self.page.evaluate("savedCoordinates"), "a surviving node moved to a new position")

    def test_selection_pulse_is_bounded_cancelled_and_reduced(self):
        self.page.locator(".node-row").first.click()
        self.assertGreater(self.page.locator(".motion-effect").count(), 0, "selection has no constellation response")
        self.assertLessEqual(self.page.locator(".motion-effect").count(), 13)
        self.page.locator(".node-row").nth(1).click()
        self.assertLessEqual(self.page.locator(".motion-effect").count(), 13)
        self.page.emulate_media(reduced_motion="reduce")
        self.page.wait_for_timeout(60)
        self.assertEqual(self.page.locator(".motion-effect").count(), 0)
        self.assertEqual(self.page.evaluate("document.getAnimations().filter(a => a.playState === 'running').length"), 0)
        self.assertEqual(self.page.locator('.node[aria-pressed="true"]').count(), 1)
        self.page.locator(".node-row").nth(2).click()
        self.assertEqual(self.page.locator(".motion-effect").count(), 0)
        self.assertIn("выбрано:", self.page.locator("#selection-status").text_content())

    def test_search_and_repeated_mode_do_not_rebuild_scene(self):
        self.page.evaluate("window.savedNode = document.querySelector('.node')")
        self.page.locator("#node-search").fill("Мар")
        self.assertTrue(self.page.evaluate("savedNode.isConnected"))
        self.page.locator("#mode-participants").click()
        self.assertTrue(self.page.evaluate("savedNode.isConnected"), "selecting the current mode rebuilt the map")
        self.assertEqual(self.page.locator(".motion-effect").count(), 0)

    def test_export_during_selection_contains_only_final_state(self):
        with self.page.expect_download() as download:
            self.page.evaluate("""() => {
              document.querySelector('.node-row').click();
              if (!document.querySelector('.motion-effect')) throw new Error('no active selection episode');
              document.querySelector('#export-svg').click();
            }""")
        svg = Path(download.value.path()).read_text()
        self.assertNotIn("motion-effect", svg)
        self.assertNotIn("node-hit", svg)
        self.assertNotIn("animation", svg)
        self.assertNotIn("data-node", svg)
        self.assertNotIn("aria-", svg)
        self.assertIn("Мария", svg)

    def test_small_touch_viewport_has_correct_mode_and_pan_distance(self):
        self.page.set_viewport_size({"width": 375, "height": 900})
        self.page.wait_for_timeout(220)
        indicator = self.page.locator('.mode-switch').evaluate("""el => {
          const active = el.querySelector('[aria-pressed="true"]');
          const style = getComputedStyle(el, '::before');
          return [new DOMMatrix(style.transform).m41, parseFloat(style.width), active.offsetLeft, active.offsetWidth];
        }""")
        self.assertAlmostEqual(indicator[0], indicator[2], delta=1)
        self.assertAlmostEqual(indicator[1], indicator[3], delta=1)
        self.page.locator('#atlas-svg').scroll_into_view_if_needed()
        result = self.page.locator('#atlas-svg').evaluate("""svg => {
          const rect = svg.getBoundingClientRect();
          const x = rect.x + 20, y = rect.y + 20;
          const inverse = svg.getScreenCTM().inverse();
          const expected = new DOMPoint(40, 0).matrixTransform(new DOMMatrix([inverse.a, inverse.b, inverse.c, inverse.d, 0, 0]));
          const event = (type, cx) => svg.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 91, button: 0, clientX: cx, clientY: y }));
          // A synthetic pointer is not registered with the browser's capture table.
          const capture = svg.setPointerCapture; svg.setPointerCapture = () => {};
          event('pointerdown', x); event('pointermove', x + 40);
          const matrix = svg.querySelector('#graph-layer > g').transform.baseVal.consolidate().matrix;
          event('pointercancel', x + 40); svg.setPointerCapture = capture;
          return { actual: matrix.e, expected: expected.x, dragging: svg.classList.contains('is-panning') };
        }""")
        self.assertAlmostEqual(result['actual'], result['expected'], delta=.1)
        self.assertFalse(result['dragging'])

    def test_fast_mode_changes_finish_without_stale_effects(self):
        self.page.evaluate("""() => {
          for (let i = 0; i < 8; i++) {
            document.querySelector('.node-row').click();
            document.querySelector('#mode-chats').click();
            document.querySelector('#mode-participants').click();
          }
        }""")
        self.page.wait_for_timeout(750)
        self.assertEqual(self.page.locator('.motion-effect').count(), 0)
        self.assertEqual(self.page.locator('.node').count(), 8)
        self.assertEqual(self.page.locator('#mode-participants').get_attribute('aria-pressed'), 'true')
        self.assertEqual(self.page.evaluate("document.getAnimations().filter(a => a.playState === 'running').length"), 0)
        self.page.locator('.node').first.focus()
        self.page.keyboard.press('ArrowRight')
        self.page.keyboard.press('Space')
        self.assertEqual(self.page.locator('.node[aria-pressed="true"]').count(), 1)
        self.page.keyboard.press('Escape')
        self.assertEqual(self.page.locator('.motion-effect').count(), 0)

    def test_import_drop_target_and_export_cancellation_keep_data(self):
        self.page.evaluate("""() => {
          const zone = document.querySelector('#dropzone'), child = zone.querySelector('svg');
          const data = new DataTransfer(); data.items.add(new File(['{}'], 'test.json', {type: 'application/json'}));
          zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: data }));
          child.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: data }));
          child.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: data }));
        }""")
        self.assertIn('is-dragging', self.page.locator('#dropzone').get_attribute('class'))
        # A second mode change in the same task makes the unfinished PNG obsolete.
        downloads = []
        self.page.on('download', lambda download: downloads.append(download))
        self.page.evaluate("""() => {
          document.querySelector('#export-png').click();
          document.querySelector('#mode-chats').click();
        }""")
        self.page.wait_for_timeout(500)
        self.assertEqual(downloads, [])
        self.assertEqual(self.page.locator('#export-png').get_attribute('aria-busy'), 'false')
        self.assertTrue(self.page.locator('#export-png').is_enabled())
        count = self.page.locator('.node').count()
        self.page.locator('#file-input').set_input_files(str(ROOT / 'fixtures/result-invalid.json'))
        self.page.locator('#status.is-error').wait_for()
        self.assertEqual(self.page.locator('.node').count(), count)
        self.assertIn('текущая карта сохранена', self.page.locator('#status').inner_text())

    def test_failed_import_clears_pending_png_and_allows_retry(self):
        self.page.evaluate("""() => {
          const toBlob = HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
            toBlob.call(this, blob => { window.releasePng = () => callback(blob); }, ...args);
          };
          document.querySelector('#export-png').click();
        }""")
        self.page.wait_for_function('() => typeof window.releasePng === "function"')
        self.page.locator('#file-input').set_input_files(str(ROOT / 'fixtures/result-invalid.json'))
        self.page.locator('#status.is-error').wait_for()
        self.page.evaluate('window.releasePng()')
        self.assertEqual(self.page.locator('#export-png').get_attribute('aria-busy'), 'false')
        self.assertTrue(self.page.locator('#export-png').is_enabled())
        self.assertNotIn('…', self.page.locator('#export-png').text_content())

    def test_period_focus_survives_changed_activity_counts(self):
        self.page.locator('.timeline-point').first.focus()
        period = self.page.locator('.timeline-point').first.get_attribute('data-from')
        self.page.evaluate("""() => {
          const select = document.querySelector('#person-filter');
          select.selectedIndex = 1;
          select.dispatchEvent(new Event('change'));
        }""")
        self.assertTrue(self.page.evaluate("document.activeElement.matches('.timeline-point')"),
                        'a changed count focused a decorative bar instead of the period button')
        self.assertEqual(self.page.evaluate("document.activeElement.dataset.from"), period)

    def test_press_near_node_edge_keeps_the_same_click_target(self):
        import json
        dense = {'id': 'dense', 'name': 'dense', 'messages': [
            {'id': i, 'from': f'participant {i}', 'from_id': f'user{i}', 'date': '2026-06-01', 'text': ''}
            for i in range(50)
        ]}
        self.page.locator('#file-input').set_input_files({'name': 'dense.json', 'mimeType': 'application/json', 'buffer': json.dumps(dense).encode()})
        self.page.locator('.node').first.wait_for()
        self.page.wait_for_timeout(750)
        self.page.locator('#atlas-svg').scroll_into_view_if_needed()
        point = self.page.locator('.node').first.evaluate("""node => {
          const bounds = node.getBoundingClientRect();
          return { id:node.dataset.nodeId, x:bounds.x + bounds.width * .999, y:bounds.y + bounds.height / 2 };
        }""")
        self.page.mouse.move(point['x'], point['y'])
        self.assertEqual(self.page.evaluate('p => document.elementFromPoint(p.x, p.y).dataset.nodeId', point), point['id'])
        self.page.mouse.down()
        self.page.wait_for_timeout(160)
        self.page.mouse.up()
        self.assertEqual(self.page.locator('.node[aria-pressed="true"]').count(), 1, 'press lost its target')
        self.assertEqual(self.page.locator('.node[aria-pressed="true"]').get_attribute('data-node-id'), point['id'])


if __name__ == "__main__":
    unittest.main(verbosity=2)
