# telegram constellation audit implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the local Telegram Constellation app, bring its UI and documentation into the Chebaturkin voice, and publish it through GitHub Pages.

**Architecture:** Keep the vanilla static site and aggregate-only parser. Make imports transactional in `app.js`, keep relation derivation in `app-data.js`, expose timeline and inspector state through semantic HTML/SVG controls, and ship a no-network CSP plus GitHub Actions Pages workflow.

**Tech Stack:** vanilla ES modules, Web Worker, SVG, CSS, Node `node:test`, Python Playwright, GitHub CLI.

---

### Task 1: lock privacy and import invariants before changing behavior

**Files:**
- Modify: `scripts/data-tests.mjs`
- Modify: `scripts/interaction_test.py`
- Modify: `scripts/smoke_test.py`
- Test: the commands below

- [ ] **Step 1: add a failing browser regression for a failed replacement import.** After the valid fixture is loaded, load `fixtures/result-invalid.json` and assert that the node count and dataset summary remain unchanged while the status has an error.

```python
before = page.locator('#atlas-svg .node').count()
summary = page.locator('#dataset-label').inner_text()
page.locator('#file-input').set_input_files(str(INVALID))
page.wait_for_function("document.querySelector('#status').classList.contains('is-error')")
assert page.locator('#atlas-svg .node').count() == before
assert page.locator('#dataset-label').inner_text() == summary
```

- [ ] **Step 2: run `APP_PORT=4178 python3 scripts/interaction_test.py` and confirm the new assertion fails because the current error path calls `clearData()`.**
- [ ] **Step 3: add a data invariant for every normalized record.** Assert that `JSON.stringify(model)` excludes both a unique message body and the `source` key, while chat and sender labels remain available.
- [ ] **Step 4: run `node --test scripts/data-tests.mjs` and confirm the new test fails only for the missing invariant.
- [ ] **Step 5: commit the red tests with `git add scripts && git commit -m "test: cover import rollback and privacy invariants"`.**

### Task 2: make replacement imports transactional and exports clean

**Files:**
- Modify: `app.js`
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `scripts/interaction_test.py`

- [ ] **Step 1: replace every import-error `clearData()` call with a rollback-only path.** Preserve `sourceModel`, `visibleModel`, filters, zoom and selected state; hide progress, re-enable controls for the existing model, and set an error status. Use this shape for all worker, reader, parser and `applyModel` failures:

```js
function finishImportError(error) {
  setImporting(false);
  if (sourceModel) {
    setEnabled(true);
    setStatus(error.userMessage || error.message || 'формат файла не распознан.', true);
    return;
  }
  clearData({ announce: false });
  setStatus(error.userMessage || error.message || 'формат файла не распознан.', true);
}
```

`clearData({ announce = true })` must remain the only path that drops a valid model and must keep its explicit user-facing message.

- [ ] **Step 2: store and render the selected file name.** Add `<span id="dataset-file">файл не выбран</span>` near the summary, set it from `file.name`, and clear it only in `clearData()`.
- [ ] **Step 3: make `exportableSvg()` strip all `aria-*`, `role`, `tabindex` and `data-*` attributes recursively before serialization. Keep visible labels and `<title>` elements.
- [ ] **Step 4: add a focused interaction assertion that an SVG download payload contains no `aria-`, `role=`, `tabindex` or `data-` attributes and no fixture message body.**
- [ ] **Step 5: run the interaction test and `node --test scripts/data-tests.mjs`; both must pass.**
- [ ] **Step 6: commit with `git add app.js index.html styles.css scripts && git commit -m "fix: preserve active atlas during failed imports"`.**

### Task 3: expose coherent slice state, timeline controls and relation detail

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `scripts/interaction_test.py`

- [ ] **Step 1: add a `reset-filters` button beside the filter heading, hidden until a chat, participant or date filter is active.** It clears only filter values and calls `render()`; it does not change zoom or pan.
- [ ] **Step 2: replace `setDatasetLabel()` with a snapshot string that includes message count, node count, relation count and date range, while keeping the filename in its own element.** Use `fmtNum`, `pluralRu` and `shortDate` so the string stays localized.
- [ ] **Step 3: add relation breakdown markup to the inspector and populate it from `visibleModel.edges`, grouping counts by `reply`, `mention`, `shared` and `time`. Use `textContent`/DOM nodes rather than interpolating untrusted labels into HTML.
- [ ] **Step 4: render each period as a `<button>` inside `#timeline-layer` with an accessible name containing its date and message count. On click/Enter, toggle `from-date` and `to-date` to the period’s calendar day and call `render()`; selecting the same period again clears both dates.
- [ ] **Step 5: add visible focus styles for timeline buttons and the reset-filters button, preserving the existing palette and reduced-motion rule.
- [ ] **Step 6: extend Playwright interaction checks for reset filters, timeline selection and relation breakdown; run them and fix any DOM timing issues.
- [ ] **Step 7: commit with `git add index.html app.js styles.css scripts && git commit -m "feat: make slice state and timeline actionable"`.**

### Task 4: apply copy and security metadata across the project

**Files:**
- Modify: `index.html`
- Modify: `README.md`
- Modify: `AGENT_PROMPT.md`
- Modify: `docs/DESIGN-RULES.md`
- Modify: `docs/QA-CHECKLIST.md`
- Modify: `docs/superpowers/specs/2026-10-08-telegram-constellation-design.md`
- Modify: `docs/superpowers/specs/2026-10-09-telegram-constellation-polish-design.md`
- Modify: `scripts/design-copy-check.mjs`
- Create: `.nojekyll`
- Create: `.github/workflows/pages.yml`

- [ ] **Step 1: rewrite user-facing Russian strings with lowercase sentence starts and direct actions.** Preserve proper names, code and exact file names. Keep privacy wording factual: local browser processing, no network import, aggregate-only model.
- [ ] **Step 2: add a CSP meta tag to `index.html` allowing only self-hosted scripts/styles/fonts, `data:`/`blob:` images for export, self workers and no `connect-src`/object sources.**
- [ ] **Step 3: rewrite README as the project landing page with GitHub Pages URL placeholder-free after publication, local run command, supported export shapes, privacy boundaries, limits and verification commands.
- [ ] **Step 4: synchronize design rules, QA checklist and specs with actual behavior: rollback preserves an existing map, timeline periods are buttons, inspector lists relation types, and SVG export is metadata-clean.**
- [ ] **Step 5: extend `design-copy-check.mjs` with the final forbidden legacy labels and required privacy phrases, then run `node scripts/design-copy-check.mjs`.
- [ ] **Step 6: add a workflow that uploads the repository root with `actions/upload-pages-artifact@v3` and deploys with `actions/deploy-pages@v4` on pushes to `main`; add `.nojekyll` so static asset paths are served as-is.
- [ ] **Step 7: run the complete local checks and commit with `git add . && git commit -m "docs: align constellation copy and Pages release"`.**

### Task 5: publish and verify the GitHub page

**Files:**
- Modify: repository metadata through `gh`
- Verify: GitHub repository, workflow and Pages URL

- [ ] **Step 1: create the public repository with `gh repo create chebaturkin/telegram-constellation --public --source . --remote origin --push --description "локальный визуальный атлас Telegram-экспортов без загрузки файлов на сервер"`.
- [ ] **Step 2: enable Pages with `gh api --method POST repos/chebaturkin/telegram-constellation/pages -f build_type=workflow` and inspect the workflow run with `gh run list --repo chebaturkin/telegram-constellation --limit 1`.
- [ ] **Step 3: set the repository homepage/description to the published Pages URL once GitHub returns it, then verify with `gh repo view --json url,homepageUrl,description,isPrivate`.
- [ ] **Step 4: open the published URL in a browser, import the fixture, check the privacy statement, timeline and mobile layout, and confirm the browser makes no external import request.
- [ ] **Step 5: record the final URL and test outputs in the completion report; do not claim release until the fresh checks and published page both succeed.
