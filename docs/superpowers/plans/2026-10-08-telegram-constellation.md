# Telegram Constellation Professional Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Укрепить импорт, нормализацию, карту и responsive-интерфейс Telegram Constellation, сохранив приватный client-side сценарий и атласную дизайн-систему.

**Architecture:** Оставить четыре текущих слоя (`app-data.js`, `import-worker.js`, `app.js`, `index.html`/`styles.css`), но чётко разделить нормализацию, UI-состояния и рендер. Нормализатор возвращает только агрегаты и технические метаданные, Worker управляет тяжёлым импортом, UI отображает согласованный фильтрованный срез. Изменения проверяются тестами данных, design-copy check и Playwright smoke.

**Tech Stack:** Vanilla ES modules, Web Worker, SVG, CSS, Node `node:test`, Python Playwright, локальный static server.

---

### Task 1: Укрепить нормализацию и обработку грязных экспортов

**Files:**
- Modify: `app-data.js`
- Test: `scripts/data-tests.mjs`

- [ ] **Step 1: Добавить падающие тесты** для `null`-чатов/сообщений, пустых `from_id`/дат, невалидного календарного дня, label fallback после появления имени, и диапазона `from > to` на уровне фильтра.
- [ ] **Step 2: Запустить `node --test scripts/data-tests.mjs` и зафиксировать ожидаемые падения.**
- [ ] **Step 3: Реализовать безопасные guard'ы:** `extractChats` фильтрует только объектные чаты; `normalizeModel` пропускает не-объекты; fallback-поля используют `firstNonEmpty`; календарная дата проверяется до `toISOString`; `senderInfo` обновляет имя участника, если первая запись была без имени; `filterModel` возвращает согласованную пустую модель с кодом/флагом invalid range, а не молча меняет данные.
- [ ] **Step 4: Построить индексы mention-целей один раз на `buildEdges` и ограничить повторную работу при фильтрации, сохранив одинаковые counts.**
- [ ] **Step 5: Запустить тесты и убедиться, что весь набор проходит.**

### Task 2: Сделать импорт отменяемым и устойчивым

**Files:**
- Modify: `app.js`
- Modify: `import-worker.js`
- Modify: `index.html`
- Modify: `styles.css`
- Test: `scripts/interaction_test.py`

- [ ] **Step 1: Добавить в импортный блок кнопку `Отменить` и отдельный статус состояния чтения.**
- [ ] **Step 2: Ввести единый `cancelImport()`**, который увеличивает token, abort'ит FileReader, завершает Worker и скрывает прогресс без очистки уже загруженной модели.
- [ ] **Step 3: Перенести size-check после отмены предыдущего импорта; обернуть `new Worker()` в `try/catch` и использовать синхронный FileReader fallback.**
- [ ] **Step 4: Сбросить `min/max` дат при каждом импорте и проверять, что сообщения/файл имеют поддерживаемую форму до запуска рендера.**
- [ ] **Step 5: Прогнать Playwright fixture, oversized simulation и invalid fixture; убедиться, что устаревший import не перезаписывает карту.**

### Task 3: Исправить состояние карты и инспектора

**Files:**
- Modify: `app.js`
- Modify: `index.html`
- Modify: `styles.css`

- [ ] **Step 1: Разделить `selectedId` и `previewId`; очищать preview на `mouseleave`/blur, оставляя закреплённый выбор.**
- [ ] **Step 2: Ввести roving tabindex для видимых SVG-узлов, стрелочную навигацию и Escape-сброс; добавить полную подпись через `<title>` без вывода текста сообщений.**
- [ ] **Step 3: Ограничить live-region обновления статусом и выбранным узлом, чтобы hover не создавал шум.**
- [ ] **Step 4: Отфильтровать рёбра по видимым endpoints в relationship-only, добавить явный empty state timeline и объяснение invalid date range.**
- [ ] **Step 5: Сделать PNG export зависимым от `renderVersion`, чтобы смена фильтра/масштаба не скачивала устаревший SVG.**

### Task 4: Пересобрать макет под карту и малые экраны

**Files:**
- Modify: `index.html`
- Modify: `styles.css`

- [ ] **Step 1: Перенести timeline в atlas column или связать через grid-area, чтобы он шёл сразу под картой.**
- [ ] **Step 2: На mobile расставить порядок импорт → карта → параметры/фильтры → inspector → timeline/legend; сохранить достижимость всех контролов.**
- [ ] **Step 3: Поднять контраст muted/disabled текстов и оставить видимый focus-ring; не менять палитру за пределами дизайн-системы без необходимости.**
- [ ] **Step 4: Добавить поисковое поле для длинных списков или простой filter-as-you-type перед select, если dataset содержит больше 30 чатов/участников.**
- [ ] **Step 5: Проверить 320/375/768/1440 px, 200% zoom и reduced motion.**

### Task 5: Регрессии, приватность и выпускная проверка

**Files:**
- Modify: `scripts/interaction_test.py`
- Modify: `scripts/smoke_test.py`
- Modify: `docs/QA-CHECKLIST.md`
- Modify: `README.md`

- [ ] **Step 1: Расширить Playwright smoke:** hover cleanup, keyboard node navigation, cancel, date reset, mobile order, empty timeline, SVG/PNG export and clear-data.
- [ ] **Step 2: Запустить `node --test scripts/data-tests.mjs`.**
- [ ] **Step 3: Запустить `node scripts/design-copy-check.mjs`.**
- [ ] **Step 4: Запустить Playwright через `python3` и локальный static server; проверить отсутствие внешних запросов.**
- [ ] **Step 5: Обновить README/QA checklist фактическими сценариями и ограничениями; просмотреть diff и убедиться, что исходный текст не попадает в модель/DOM/экспорт.**
