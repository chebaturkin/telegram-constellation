import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "result-small.json"
INVALID = ROOT / "fixtures" / "result-invalid.json"
PORT = os.environ.get("APP_PORT", "4178")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.goto(f"http://127.0.0.1:{PORT}/index.html")
    page.wait_for_load_state("networkidle")
    page.locator("#file-input").set_input_files(str(FIXTURE))
    page.wait_for_function("document.querySelector('#dataset-label').textContent.includes('сообщений')")

    before_nodes = page.locator("#atlas-svg .node").count()
    before_summary = page.locator("#dataset-label").inner_text()
    page.locator("#file-input").set_input_files(str(INVALID))
    page.wait_for_function("document.querySelector('#status').classList.contains('is-error')")
    assert page.locator("#atlas-svg .node").count() == before_nodes
    assert page.locator("#dataset-label").inner_text() == before_summary
    assert "текущая карта сохранена" in page.locator("#status").inner_text().lower()

    node = page.locator("#atlas-svg .node").first
    node.focus()
    focused_id = node.get_attribute("data-node-id")
    assert page.locator("#focus-title").inner_text() != "Выберите точку на карте"
    assert page.evaluate("document.activeElement?.getAttribute('data-node-id')") == focused_id
    assert page.locator("#relation-breakdown").inner_text() != ""

    all_nodes = page.locator("#atlas-svg .node").count()
    page.locator("#chat-filter").select_option("101")
    assert page.locator("#atlas-svg .node").count() == 1
    assert "5 сообщений" not in page.locator("#dataset-label").inner_text()
    page.locator("#reset-filters").click()
    assert page.locator("#chat-filter").input_value() == "all"
    assert page.locator("#person-filter").input_value() == "all"
    assert page.locator("#atlas-svg .node").count() == all_nodes

    with page.expect_download() as download_info:
        page.locator("#export-svg").click()
    exported = Path(download_info.value.path()).read_text(encoding="utf-8")
    assert "data-node-id" not in exported
    assert "aria-label" not in exported
    assert "role=\"button\"" not in exported
    assert "Доброе утро" not in exported

    period = page.locator("#timeline-svg .timeline-point").first
    period.focus()
    period.press("Enter")
    assert page.locator("#from-date").input_value() != ""
    assert page.locator("#to-date").input_value() != ""
    period.press("Enter")
    assert page.locator("#from-date").input_value() == ""
    assert page.locator("#to-date").input_value() == ""

    page.locator("#clear-data").click()
    assert "Загрузите файл" in page.locator("#alt-text").inner_text()
    assert page.locator("#focus-title").inner_text() == "Выберите точку на карте"

    browser.close()
