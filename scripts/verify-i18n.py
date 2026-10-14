import os,re,json,pathlib
from playwright.sync_api import sync_playwright, expect
REPO='telegram-constellation'
PORT={'project-garden':4421,'data-postcard':4422,'telegram-constellation':4423}[REPO]
URL=os.environ.get('APP_URL',f'http://127.0.0.1:{PORT}/')
with sync_playwright() as p:
 browser=p.chromium.launch()
 for language,expected in [('en-US','en'),('ru-RU','ru'),('fr-FR','en')]:
  context=browser.new_context(locale=language)
  page=context.new_page(); page.goto(URL); expect(page.locator('html')).to_have_attribute('lang',expected)
  expect(page.locator(f'[data-language="{expected}"]')).to_have_attribute('aria-pressed','true')
  if language=='en-US':
   if REPO=='telegram-constellation':page.locator('#open-demo').click();page.locator('.node').first.wait_for()
   page.locator('[data-language="ru"]').click()
   if REPO=='project-garden':assert 'сайт студии' in page.locator('#plants-layer').inner_text()
   elif REPO=='data-postcard':assert page.locator('#title-input').input_value()=='неделя чтения'
   else:assert 'Мария' in page.locator('#node-list').inner_text()
   page.locator('[data-language="en"]').click()
   if REPO=='project-garden':assert 'studio website' in page.locator('#plants-layer').inner_text()
   elif REPO=='data-postcard':
    assert page.locator('#title-input').input_value()=='a week of reading'
    page.locator('#sample-select').select_option('expenses');assert page.locator('#title-input').input_value()=='where the money went'
   else:assert 'Maria' in page.locator('#node-list').inner_text()
  context.close()
 context=browser.new_context(locale='en-US',accept_downloads=True,viewport={'width':1440,'height':1000})
 page=context.new_page(); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(URL+'?keep=1#draft'); expect(page.locator('html')).to_have_attribute('lang','en')
 if REPO=='project-garden':
  page.locator('.plant-button').first.click(); page.locator('#project-note').fill('pending пользовательский текст'); page.locator('#project-name').fill('custom название'); pending=page.locator('#project-name').input_value()
 elif REPO=='data-postcard':
  page.locator('#table-body input').first.fill('pending пользовательский текст'); page.locator('#tab-text').click();page.locator('#title-input').fill('custom название');page.locator('#tab-data').click();pending=page.locator('#title-input').input_value()
 else:
  page.locator('#open-demo').click(); expect(page.locator('#workspace-content')).to_be_visible();page.locator('#mode-participants').click();page.locator('#node-search').fill('Maria');pending=page.locator('#stat-messages').inner_text()
 before_text=page.locator('body').inner_text();page.locator('[data-language="en"]').click();assert page.locator('body').inner_text()==before_text,'active language must not reset dynamic labels'
 page.locator('[data-language="ru"]').click();expect(page.locator('html')).to_have_attribute('lang','ru')
 assert 'keep=1' in page.url and '#draft' in page.url and 'lang=ru' in page.url
 if REPO=='project-garden':assert page.locator('#project-note').input_value()=='pending пользовательский текст' and page.locator('#project-name').input_value()==pending
 elif REPO=='data-postcard':assert page.locator('#table-body input').first.input_value()=='pending пользовательский текст' and page.locator('#title-input').input_value()==pending
 else:assert page.locator('#node-search').input_value()=='Maria' and page.locator('#stat-messages').inner_text()==pending
 page.locator('[data-language="en"]').focus();page.locator('[data-language="en"]').press('Enter');expect(page.locator('html')).to_have_attribute('lang','en')
 if REPO=='project-garden':
  page.locator('#project-form button[type="submit"]').click(); expect(page.locator('#toast')).to_contain_text('saved');page.reload();page.locator('.plant-button').filter(has_text=pending).click(); assert page.locator('#project-note').input_value()=='pending пользовательский текст'
  page.locator('#file-input').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':b'{bad'});expect(page.locator('#toast')).to_contain_text('json')
  with page.expect_download() as event:page.locator('#export-json').click()
  downloaded=json.loads(pathlib.Path(event.value.path()).read_text());assert 'pending пользовательский текст' in json.dumps(downloaded,ensure_ascii=False)
 elif REPO=='data-postcard':
  page.reload(); assert page.locator('#table-body input').first.input_value()=='pending пользовательский текст'; page.locator('#apply-table').click()
  with page.expect_download() as event: page.locator('#export-html').click()
  html=pathlib.Path(event.value.path()).read_text();assert 'lang="en"' in html and 'postcard data' in html and 'pending пользовательский текст' in html
  page.locator('#import-details').evaluate('(n)=>n.open=true');page.locator('#paste-input').fill('bad');page.locator('#paste-button').click();expect(page.locator('#data-errors')).to_be_visible();assert not re.search('[а-яё]',page.locator('#data-errors').inner_text(),re.I)
 else:
  page.locator('#node-search').fill('');page.locator('#file-input').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':b'{bad'});expect(page.locator('#status')).to_contain_text('current map');expect(page.locator('#workspace-content')).to_be_visible()
  with page.expect_download() as event:page.locator('#export-svg').click()
  svg=pathlib.Path(event.value.path()).read_text();assert 'Maria' in svg and not re.search('[а-яё]',svg,re.I)
 page.goto(URL);expect(page.locator('html')).to_have_attribute('lang','en')
 page.locator('[data-language="ru"]').click();page.goto(URL);expect(page.locator('html')).to_have_attribute('lang','ru')
 page.goto(URL+'?lang=en');expect(page.locator('html')).to_have_attribute('lang','en')
 for width in [320,390,768,1440]:
  page.set_viewport_size({'width':width,'height':1000})
  for lang in ['ru','en']:
   page.locator(f'[data-language="{lang}"]').click()
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(REPO,width,lang)
   assert page.locator('[data-language-control]').is_visible()
 assert not errors,errors
 context.close()
 context=browser.new_context(locale='en-US');context.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw Error('blocked')}});history.replaceState=()=>{throw Error('blocked')}")
 page=context.new_page();page.goto(URL+'?lang=ru');expect(page.locator('html')).to_have_attribute('lang','ru');page.locator('[data-language="en"]').click();expect(page.locator('html')).to_have_attribute('lang','en');context.close()
 browser.close()
 print(REPO+': locale defaults, pending data, English error/export, persistence, blocked APIs and 8 responsive states passed')
