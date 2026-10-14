# telegram constellation professional polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Сделать локальный Telegram-атлас устойчивым к ошибкам импорта и удобнее для исследования текущего фильтрованного среза, сохранив приватность и существующую печатную дизайн-систему.

**Architecture:** Сохранить vanilla ES modules, Web Worker и SVG. Нормализатор будет возвращать безопасную статистику, UI — держать старую модель до успешного нового импорта, а слой среза — отдельно управлять фильтрами, timeline и инспектором. Все новые функции работают только на агрегатах и не добавляют постоянное хранилище.

**Tech Stack:** HTML, CSS, JavaScript ES modules, Web Worker, SVG, Node node:test, Python Playwright.

---

## Карта файлов

- Modify: app-data.js — безопасные статистики модели и фильтра.
- Modify: scripts/data-tests.mjs — тесты статистики, пустых дат и согласованного среза.
- Modify: import-worker.js — передача только агрегированной модели и диагностик.
- Modify: app.js — транзакционный импорт, сводка среза, сброс фильтров, интерактивная timeline, инспектор связей.
- Modify: index.html — элементы сводки, отдельный сброс фильтров, легенда типов связей, область разбивки связей.
- Modify: styles.css — правила для новых элементов без изменения дизайн-системы.
- Modify: scripts/interaction_test.py — браузерные проверки отказа импорта, фильтров и timeline.
- Modify: README.md — описание нового поведения импорта и управления периодами.
- Modify: docs/QA-CHECKLIST.md — отметить новые обязательные проверки.

---

### Task 1: Статистика безопасной модели

**Files:**
- Modify: app-data.js
- Test: scripts/data-tests.mjs

- [x] **Step 1: Добавить RED-тесты.**

В конец scripts/data-tests.mjs добавить:

    test('model stats expose safe diagnostics without message text', () => {
      const model = parseExport({
        chats: { list: [{
          id: 1,
          name: 'Чат',
          messages: [
            message(1, 1, '2026-02-01T12:00:00'),
            { id: 2, type: 'service', actor_id: 'user2', date: '2026-02-02T12:00:00' },
            null,
            message(3, 2, null, { reply_to_message_id: 1 })
          ]
        }] }
      });
      assert.equal(model.stats.messageCount, 2);
      assert.equal(model.stats.skippedCount, 1);
      assert.equal(model.stats.undatedCount, 1);
      assert.deepEqual(model.stats.relationCounts, { reply: 1, mention: 0, shared: 1, time: 0 });
      assert.equal(JSON.stringify(model).includes('PRIVATE_MESSAGE_BODY'), false);
    });

    test('filtered stats describe only the active slice', () => {
      const model = parseExport(archive(
        chat(1, [message(1, 1, '2026-02-01T12:00:00'), message(2, 2, '2026-02-01T12:01:00')]),
        chat(2, [message(3, 3, null)])
      ));
      const view = filterModel(model, { chatId: '1', mode: 'participants' });
      assert.equal(view.stats.messageCount, 2);
      assert.equal(view.stats.undatedCount, 0);
      assert.equal(view.stats.chatCount, 1);
      assert.equal(view.stats.participantCount, 2);
    });

- [x] **Step 2: Запустить только новые тесты и убедиться, что они падают.**

Run: node --test scripts/data-tests.mjs

Expected: FAIL because skippedCount, undatedCount and relationCounts are not present yet.

- [x] **Step 3: Добавить диагностические счётчики в нормализатор.**

В normalizeModel завести skippedCount = 0, увеличивать его для каждого не-объекта и передавать в modelFromRecords. В modelFromRecords посчитать undatedCount по записям без dateKey, а relationCounts — по выбранным рёбрам с ключами reply, mention, shared, time и нулевыми значениями для отсутствующих типов. Добавить эти поля в stats, не добавляя исходные записи.

- [x] **Step 4: Сохранить диагностические счётчики при фильтрации.**

Передать skippedCount: Number(model.stats?.skippedCount || 0) в modelFromRecords для filterModel, чтобы фильтрация не маскировала качество исходного импорта, а undatedCount и relationCounts пересчитывались по текущему срезу.

- [x] **Step 5: Запустить полный набор данных.**

Run: node --test scripts/data-tests.mjs

Expected: 22 tests pass, 0 failures.

---

### Task 2: Транзакционный импорт

**Files:**
- Modify: app.js
- Modify: import-worker.js
- Test: scripts/interaction_test.py

- [x] **Step 1: Добавить RED-проверку сохранения карты после ошибки нового файла.**

После успешного fixture import в scripts/interaction_test.py добавить:

    before_nodes = page.locator('#atlas-svg .node').count()
    page.locator('#file-input').set_input_files(str(ROOT / 'fixtures' / 'result-invalid.json'))
    page.wait_for_function("document.querySelector('#status').classList.contains('is-error')")
    assert page.locator('#atlas-svg .node').count() == before_nodes
    assert "текущая карта сохранена" in page.locator('#status').inner_text().lower()

- [x] **Step 2: Запустить interaction-тест и зафиксировать падение.**

Run: python3 -m http.server 4178 >/tmp/telegram-constellation-test.log 2>&1 & server_pid=$!; sleep 1; python3 scripts/interaction_test.py; code=$?; kill $server_pid; exit $code

Expected: FAIL because error handlers call clearData() and remove the previous model.

- [x] **Step 3: Ввести отдельное завершение неудачного импорта.**

В app.js добавить finishImportError(message): остановить только текущие reader/worker, скрыть progress, вызвать setImporting(false), оставить sourceModel и visibleModel, затем показать «Импорт не завершён. Текущая карта сохранена. ...» если модель есть, иначе исходное сообщение ошибки. Заменить вызовы clearData() в worker error, reader error и parse catch на этот helper.

- [x] **Step 4: Передавать имя файла без содержимого.**

Добавить в состояние activeFileName и записывать только file.name при старте чтения. Отображать имя в datasetLabel через безопасный textContent после успешного applyModel. При clearData очищать имя. Не включать имя в URL, экспорт или модель.

- [x] **Step 5: Обработать гонку отмены и нового импорта.**

В едином завершении операции проверять token === importToken перед изменением UI. При отмене оставлять sourceModel неизменной, скрывать только progress и объявлять отмену в статусе. Worker продолжает отправлять только progress, ready и безопасный error.

- [x] **Step 6: Проверить RED-тест после исправления.**

Run: python3 scripts/interaction_test.py

Expected: PASS for preserved nodes and explicit saved-map status.

---

### Task 3: Состояние среза и сброс фильтров

**Files:**
- Modify: index.html
- Modify: app.js
- Modify: styles.css
- Test: scripts/interaction_test.py

- [x] **Step 1: Добавить RED-проверку отдельного сброса фильтров.**

После импорта в interaction_test.py добавить:

    all_nodes = page.locator('#atlas-svg .node').count()
    page.locator('#chat-filter').select_option('101')
    assert page.locator('#atlas-svg .node').count() < all_nodes
    page.locator('#reset-filters').click()
    assert page.locator('#chat-filter').input_value() == 'all'
    assert page.locator('#person-filter').input_value() == 'all'
    assert page.locator('#atlas-svg .node').count() == all_nodes

- [x] **Step 2: Убедиться, что тест падает до добавления кнопки.**

Run: python3 scripts/interaction_test.py

Expected: FAIL because #reset-filters does not exist.

- [x] **Step 3: Добавить кнопку и сводку в разметку.**

В секцию фильтров добавить кнопку id="reset-filters" с текстом «Сбросить фильтры». В заголовок атласа добавить id="slice-summary" с живым текстом текущего среза. Под ним добавить id="slice-status" с role="status" и aria-live="polite".

- [x] **Step 4: Реализовать функции состояния.**

В app.js добавить hasActiveFilters(), resetFilters() и renderSliceSummary(model). resetFilters() очищает chat/person/date, сбрасывает relations-only, selection и вызывает render(). renderSliceSummary выводит число сообщений, узлов и связей, а при активном диапазоне — даты. Функция использует textContent и не вставляет пользовательский текст через innerHTML.

- [x] **Step 5: Разделить reset view и reset filters.**

resetView() оставляет фильтры без изменений и сбрасывает только zoom, pan и selectedId. setEnabled управляет новой кнопкой так же, как остальными control. Сводка обновляется после каждого render(), applyModel() и clearData().

- [x] **Step 6: Проверить новый сценарий.**

Run: python3 scripts/interaction_test.py

Expected: PASS for applying and clearing the chat filter.

---

### Task 4: Инспектор связей и интерактивная timeline

**Files:**
- Modify: index.html
- Modify: app.js
- Modify: styles.css
- Test: scripts/interaction_test.py

- [x] **Step 1: Добавить RED-проверку разбивки связей.**

После выбора первого узла в interaction test добавить:

    assert page.locator('#relation-breakdown').inner_text() != ''
    assert 'ответ' in page.locator('#relation-breakdown').inner_text().lower() or 'связ' in page.locator('#relation-breakdown').inner_text().lower()

- [x] **Step 2: Добавить элементы инспектора и легенды.**

В index.html добавить внутри focus-section <div id="relation-breakdown" class="relation-breakdown"></div>. В legend-list заменить общую строку связи на четыре строки с классами legend-line--reply, legend-line--mention, legend-line--shared, legend-line--time и короткими русскими подписями.

- [x] **Step 3: Реализовать безопасное обновление инспектора.**

В updateFocus сгруппировать рёбра выбранного узла по edge.type, отформатировать количество через fmtNum, очистить relation-breakdown и добавить строки DOM-методами. В resetInspector вернуть пустое состояние и подпись «Нет выбранного узла». Использовать только технические типы и счётчики.

- [x] **Step 4: Сделать периоды доступными и кликабельными.**

В renderTimeline добавлять каждому point атрибуты role="button", tabindex="0", aria-label, data-from, data-to. Обработчик selectPeriod(period) заполняет from/to датами периода и вызывает render. На click, Enter и Space вызывать selectPeriod. В пустом состоянии timeline оставить обычный текст.

- [x] **Step 5: Проверить timeline в браузере.**

Добавить в interaction test:

    period = page.locator('#timeline-svg .timeline-point').first
    period.focus()
    period.press('Enter')
    assert page.locator('#from-date').input_value() != ''
    assert page.locator('#to-date').input_value() != ''

Run: python3 scripts/interaction_test.py

Expected: PASS for relation breakdown and period selection.

---

### Task 5: Визуальная полировка, документация и финальная проверка

**Files:**
- Modify: styles.css
- Modify: README.md
- Modify: docs/QA-CHECKLIST.md
- Test: scripts/design-copy-check.mjs

- [x] **Step 1: Добавить CSS новых элементов в существующей системе.**

Стилизовать slice summary, reset filters, relation breakdown и интерактивные timeline points теми же CSS-переменными, правилами и focus-ring. Не добавлять градиенты, glow, glass, pill-кнопки или новые декоративные мета-подписи. В prefers-reduced-motion отключить переходы point hover.

- [x] **Step 2: Обновить README.**

Описать, что неудачный повторный импорт сохраняет текущую карту, а выбор периода на timeline применяет date filter. Уточнить, что filename отображается только в текущей вкладке и не попадает в модель/экспорт.

- [x] **Step 3: Обновить QA-чеклист.**

Добавить пункты для сохранения карты после ошибки, сброса фильтров, клавиатурного выбора периода и разбивки связей в инспекторе.

- [x] **Step 4: Запустить все проверки.**

Run: node --test scripts/data-tests.mjs

Expected: 22 tests pass, 0 failures.

Run: node scripts/design-copy-check.mjs

Expected: Design copy check passed.

Run: python3 -m http.server 4175 >/tmp/telegram-constellation-test.log 2>&1 & server_pid=$!; sleep 1; python3 scripts/smoke_test.py; smoke=$?; kill $server_pid 2>/dev/null || true; exit $smoke

Expected: smoke test exits 0.

Run: python3 -m http.server 4178 >/tmp/telegram-constellation-test.log 2>&1 & server_pid=$!; sleep 1; python3 scripts/interaction_test.py; interaction=$?; kill $server_pid 2>/dev/null || true; exit $interaction

Expected: interaction test exits 0.

- [x] **Step 5: Проверить приватность артефактов.**

Запустить Node-скрипт, который импортирует fixture через parseExport и проверяет отсутствие строки PRIVATE_MESSAGE_BODY в JSON модели. В браузере проверить отсутствие исходного текста сообщения в экспортируемом SVG, отсутствие query/hash в URL и отсутствие имён текущего fixture в DOM после clear-data.

- [x] **Step 6: Проверить responsive и reduced motion.**

В Playwright открыть страницу на 375×900 и 1440×1000, убедиться в отсутствии горизонтального overflow, видимом focus-ring и доступных кнопках. Повторить с prefers-reduced-motion: reduce и проверить отсутствие animation-duration больше 1ms.

