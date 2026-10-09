from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "result-small.json"
INVALID = ROOT / "fixtures" / "result-invalid.json"
PORT = os.environ.get("APP_PORT", "4175")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    requests = []
    page.on("request", lambda request: requests.append(request.url))
    page.goto(f"http://127.0.0.1:{PORT}/index.html")
    page.wait_for_load_state("networkidle")
    assert "файл остаётся в браузере" in page.locator("body").inner_text()
    assert page.locator("#atlas-empty").is_visible()
    page.locator("#file-input").set_input_files(str(FIXTURE))
    page.locator("#atlas-svg .node").first.wait_for()
    assert page.locator("#atlas-svg .node").count() > 0
    assert "сведено в агрегаты" in page.locator("#status").inner_text()
    page.locator("#view-mode").select_option("participants")
    assert page.locator("#atlas-svg .node").count() >= 2
    page.locator("#relations-only").check()
    assert page.locator("#atlas-svg .edge").count() >= 1
    page.locator("#relations-only").uncheck()
    page.locator("#export-svg").click()
    page.locator("#clear-data").click()
    assert page.locator("#atlas-empty").is_visible()
    page.locator("#file-input").set_input_files(str(INVALID))
    page.locator("#status.is-error").wait_for()
    assert "не найден" in page.locator("#status").inner_text().lower() or "не распознан" in page.locator("#status").inner_text().lower()
    assert not any("telegram" in url.lower() and "127.0.0.1" not in url for url in requests)
    page.set_viewport_size({"width": 375, "height": 900})
    assert page.locator(".layout").count() == 1
    browser.close()
