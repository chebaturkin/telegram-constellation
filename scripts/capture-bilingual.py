"""Capture the real welcome screen, selected map and mobile map in both languages."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
URL=os.environ.get('APP_URL','http://127.0.0.1:4423/')
with sync_playwright() as p:
 browser=p.chromium.launch()
 for language in ['ru','en']:
  out=ROOT/'docs/screenshots'/('en' if language=='en' else '');out.mkdir(parents=True,exist_ok=True)
  for mobile in [False,True]:
   context=browser.new_context(locale=language,viewport={'width':390 if mobile else 1440,'height':844 if mobile else 1000},is_mobile=mobile,has_touch=mobile,reduced_motion='reduce')
   page=context.new_page();page.goto(URL.rstrip('/')+'/?lang='+language);page.wait_for_load_state('networkidle');page.evaluate('document.fonts.ready')
   if not mobile:page.screenshot(path=str(out/'welcome.png'),full_page=True)
   page.locator('#open-demo').click();page.locator('.node').first.wait_for()
   name='Мария' if language=='ru' else 'Maria'
   page.locator('.node-row').filter(has_text=name).click();expect(page.locator('#inspector')).to_be_visible();page.wait_for_timeout(250);page.evaluate("document.activeElement.blur();window.scrollTo({top:0,behavior:'instant'})")
   page.screenshot(path=str(out/('mobile.png' if mobile else 'atlas.png')),full_page=True,animations='disabled');context.close()
 browser.close()
print('both languages: welcome, atlas and mobile captured')
