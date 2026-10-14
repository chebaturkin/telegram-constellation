import { t, getLocale, localeTag, mountLocale, translateMessage, setLocale } from './i18n.js';
import { parseExport, filterModel } from './app-data.js';
import { createDemoExport } from './demo-data.js';
import { relationNamesFor, renderNeighbors, renderImportNotes } from './app-exploration.js';
import { createMotion } from './app-motion.js';

const $ = (id) => document.getElementById(id);
const ui = {
  relationTypes: [...document.querySelectorAll('[data-relation-type]')],
  file: $('file-input'), dropzone: $('dropzone'), progressWrap: $('progress-wrap'), progressBar: $('progress-bar'), progressTrack: $('progress-track'), progressLabel: $('progress-label'), progressPercent: $('progress-percent'), cancelImport: $('cancel-import'), status: $('status'),
  viewMode: $('view-mode'), relationsOnly: $('relations-only'), resetView: $('reset-view'), resetFilters: $('reset-filters'), clearData: $('clear-data'), chatFilter: $('chat-filter'), personFilter: $('person-filter'), fromDate: $('from-date'), toDate: $('to-date'),
  exportSvg: $('export-svg'), exportPng: $('export-png'), zoomIn: $('zoom-in'), zoomOut: $('zoom-out'), zoomReset: $('zoom-reset'), datasetLabel: $('dataset-label'), atlasSvg: $('atlas-svg'), atlasFrame: $('atlas-frame'), grid: $('grid-layer'), graph: $('graph-layer'), labels: $('labels-layer'), atlasEmpty: $('atlas-empty'), atlasEmptyTitle: $('atlas-empty-title'), atlasEmptyCopy: $('atlas-empty-copy'), scale: $('atlas-scale'),
  focusTitle: $('focus-title'), focusCopy: $('focus-copy'), selectionStatus: $('selection-status'), focusMetrics: $('focus-metrics'), relationBreakdown: $('relation-breakdown'), altText: $('alt-text'), timeline: $('timeline-layer'), timelineRange: $('timeline-range'), timelineEmpty: $('timeline-empty'), sliceSummary: $('slice-summary'), sliceStatus: $('slice-status')
};

let sourceModel = null;
let visibleModel = null;
let selectedId = null;
let previewId = null;
let zoom = 1;
let pan = { x: 0, y: 0 };
let drag = null;
let activeReader = null;
let activeWorker = null;
let activeFileName = '';
let pendingFileName = '';
let newArchive = false;
let progressTimer = null;
let importToken = 0;
let renderVersion = 0;
const nodeElements = new Map();
const edgeElements = new Map();
let edgeLayer = null;
let haloLayer = null;
let hitLayer = null;
let nodeLayer = null;
let timelineKey = null;
let graphLayer = null;
let labelLayer = null;
let displayedNodes = [];
let isDemo = false;
let layoutCache = new Map();
let exportJob = null;
const exportFeedbackTimers = new Map();
const motion = createMotion();
const hoverPointer = matchMedia('(hover: hover) and (pointer: fine)');

const NS = 'http://www.w3.org/2000/svg';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtNum = (value) => new Intl.NumberFormat(localeTag()).format(Number(value || 0));
const pluralRu = (value, forms) => { if (getLocale() === 'en') return Number(value) === 1 ? forms[0] : forms[2]; const n = Math.abs(Number(value || 0)); const index = n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2; return forms[index]; };
const fmtDate = (value) => { if (!value) return '-'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toLocaleDateString(localeTag(), { day: '2-digit', month: 'short', year: 'numeric' }); };
const shortDate = (value) => { if (!value) return ''; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toISOString().slice(0, 10); };
const nodeLabel = (node) => node?.label || node?.name || t("s0");

function setStatus(message, error = false) {
  const changed = ui.status.textContent !== message;
  ui.status.textContent = message;
  ui.status.classList.toggle('is-error', error);
  if (changed) motion.play(ui.status, [{ opacity: .5 }, { opacity: 1 }], { channel: 'status' });
}
function setEnabled(enabled) {
  ui.relationTypes.forEach((input) => { input.disabled = !enabled; });
  [ui.viewMode, ui.relationsOnly, ui.resetView, ui.resetFilters, ui.clearData, ui.chatFilter, ui.personFilter, ui.fromDate, ui.toDate, ui.exportSvg, ui.exportPng, ui.zoomIn, ui.zoomOut, ui.zoomReset].forEach((el) => { if (el) el.disabled = !enabled; });
}
function setImporting(importing) {
  if (!ui.cancelImport) return;
  ui.cancelImport.hidden = !importing;
  ui.cancelImport.disabled = !importing;
  ui.cancelImport.setAttribute('aria-busy', importing ? 'true' : 'false');
  ui.dropzone.setAttribute('aria-busy', String(importing));
  ui.dropzone.classList.toggle('is-reading', importing);
}

function finishImportError(message) {
  cancelExport();
  clearTimeout(progressTimer);
  importToken += 1;
  if (activeReader) { try { activeReader.abort(); } catch { /* already finished */ } }
  if (activeWorker) { try { activeWorker.terminate(); } catch { /* already finished */ } }
  activeReader = null;
  activeWorker = null;
  pendingFileName = '';
  if (ui.progressWrap) ui.progressWrap.hidden = true;
  setProgress(0);
  setImporting(false);
  const safeMessage = String(message || t("s1"));
  setStatus(sourceModel ? t("s2") + safeMessage : safeMessage, true);
}
function setProgress(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  ui.progressBar.style.transform = `scaleX(${value / 100})`;
  ui.progressPercent.textContent = `${Math.round(value)}%`;
  ui.progressTrack?.setAttribute('aria-valuenow', String(Math.round(value)));
}
function svgEl(tag, attrs = {}) { const el = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); return el; }
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function addOptions(select, entries, firstLabel) {
  select.innerHTML = '';
  const first = document.createElement('option'); first.value = 'all'; first.textContent = firstLabel; select.append(first);
  (entries || []).forEach((entry) => { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.label || entry.name || entry.id; select.append(option); });
}
function populateControls(model) {
  ui.relationTypes.forEach((input) => { input.checked = true; });
  addOptions(ui.chatFilter, model.chats, t("s3"));
  addOptions(ui.personFilter, model.participants, t("s4"));
  ui.chatFilter.value = 'all'; ui.personFilter.value = 'all'; ui.fromDate.value = ''; ui.toDate.value = '';
  ui.fromDate.min = ''; ui.fromDate.max = ''; ui.toDate.min = ''; ui.toDate.max = '';
  ui.viewMode.value = 'auto'; ui.relationsOnly.checked = false;
  const allDates = (model.periods || []).flatMap((p) => [p.start, p.end]).filter(Boolean).sort();
  if (allDates.length) { const first = shortDate(allDates[0]); const last = shortDate(allDates.at(-1)); ui.fromDate.min = first; ui.fromDate.max = last; ui.toDate.min = first; ui.toDate.max = last; }
  setDatasetLabel(model);
}
function setDatasetLabel(model) {
  if (!model) { ui.datasetLabel.textContent = t("s5"); return; }
  const count = model.stats?.messageCount || model.nodes?.reduce((sum, n) => sum + Number(n.messageCount || 0), 0) || 0;
  const filePrefix = activeFileName ? activeFileName + ' · ' : '';
  ui.datasetLabel.textContent = filePrefix + `${fmtNum(count)} ${pluralRu(count, [t("s6"), t("s7"), t("s8")])} · ${fmtNum(model.nodes?.length || 0)} ${pluralRu(model.nodes?.length || 0, [t("s9"), t("s10"), t("s11")])}`;
}

function currentFilteredModel({ includeDates = true } = {}) {
  if (!sourceModel) return null;
  const mode = ui.viewMode.value;
  const filters = { chatId: ui.chatFilter.value, participantId: ui.personFilter.value, from: includeDates ? ui.fromDate.value : '', to: includeDates ? ui.toDate.value : '', mode, relationTypes: ui.relationTypes.filter((input) => input.checked).map((input) => input.dataset.relationType) };
  return filterModel ? filterModel(sourceModel, filters) : sourceModel;
}

function hasActiveFilters() {
  return Boolean(
    ui.chatFilter.value !== 'all'
    || ui.personFilter.value !== 'all'
    || ui.fromDate.value
    || ui.toDate.value
    || ui.relationTypes.some((input) => !input.checked)
    || ui.relationsOnly.checked,
  );
}

function renderSliceSummary(model) {
  if (!ui.sliceSummary || !ui.sliceStatus) return;
  if (!model) {
    ui.sliceSummary.textContent = '';
    ui.sliceStatus.textContent = '';
    if (ui.resetFilters) ui.resetFilters.disabled = true;
    return;
  }
  const stats = model.stats || {};
  const parts = [
    fmtNum(stats.messageCount || 0) + ' ' + pluralRu(stats.messageCount || 0, [t("s6"), t("s7"), t("s8")]),
    fmtNum(model.nodes?.length || 0) + ' ' + pluralRu(model.nodes?.length || 0, [t("s9"), t("s10"), t("s11")]),
    fmtNum(model.edges?.length || 0) + ' ' + pluralRu(model.edges?.length || 0, [t("s12"), t("s13"), t("s14")]),
  ];
  if (ui.fromDate.value || ui.toDate.value) parts.push((ui.fromDate.value || '…') + ' / ' + (ui.toDate.value || '…'));
  if (ui.relationTypes.some((input) => !input.checked)) {
    const names = ui.relationTypes.filter((input) => input.checked).map((input) => relationNamesFor(model)[input.dataset.relationType]);
    parts.push(names.length ? t("s15") + names.join(', ') : t("s16"));
  }
  ui.sliceSummary.textContent = parts.join(' · ');
  ui.sliceStatus.textContent = hasActiveFilters() ? t("s17") + parts.join(' · ') : '';
  ui.sliceStatus.hidden = !hasActiveFilters();
  if (ui.resetFilters) ui.resetFilters.disabled = !hasActiveFilters();
}

function resetFilters() {
  if (!sourceModel) return;
  ui.relationTypes.forEach((input) => { input.checked = true; });
  ui.chatFilter.value = 'all';
  ui.personFilter.value = 'all';
  ui.fromDate.value = '';
  ui.toDate.value = '';
  ui.relationsOnly.checked = false;
  selectedId = null;
  previewId = null;
  render();
}

function stableNodes(model) {
  const kind = model.nodes?.[0]?.type === 'participant' ? 'participants' : 'chats';
  if (!layoutCache.has(kind)) {
    const allNodes = kind === 'participants' ? sourceModel.participantNodes : sourceModel.chatNodes;
    layoutCache.set(kind, new Map(placeNodes(allNodes || model.nodes).map((node) => [String(node.id), node])));
  }
  return placeNodes(model.nodes).map((node) => {
    const position = layoutCache.get(kind).get(String(node.id));
    return position ? { ...node, x: position.x, y: position.y } : node;
  });
}

function buildGrid() {
  clear(ui.grid);
  for (let x = 20; x < 1000; x += 30) {
    for (let y = 20; y < 610; y += 30) ui.grid.append(svgEl('circle', { cx: x, cy: y, r: .9, class: 'grid-dot' }));
  }
}

function placeNodes(nodes) {
  const list = nodes || [];
  if (!list.length) return [];
  const max = Math.max(...list.map((n) => Number(n.messageCount || n.count || 1)), 1);
  const center = { x: 470, y: 285 };
  const spread = Math.min(248, 120 + list.length * 16);
  return list.map((node, index) => {
    const angle = (index / Math.max(list.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const ring = spread * (0.58 + ((index * 37) % 100) / 210);
    const activity = Number(node.activity ?? node.messageCount ?? node.count ?? 1);
    const radius = 10 + Math.sqrt(Math.max(activity, 1) / max) * 20;
    const color = node.color || (activity / max >= .75 ? '#e78068' : '#77a0d8');
    const single = list.length === 1;
    return { ...node, x: Number.isFinite(node.x) ? node.x : center.x + (single ? 0 : Math.cos(angle) * ring * 1.42), y: Number.isFinite(node.y) ? node.y : center.y + (single ? 0 : Math.sin(angle) * ring), radius, color, activityRatio: activity / max };
  });
}
function edgeClass(type) { return `edge edge--${String(type || 'time').toLowerCase()}`; }

function renderGraph(model) {
  const focusedNode = document.activeElement?.matches('.node') ? document.activeElement : null;
  motion.cancel('scene');
  motion.cancel('selection');
  if (newArchive || !model) {
    motion.cancel('viewport');
    clear(ui.graph); clear(ui.labels);
    nodeElements.clear(); edgeElements.clear();
    graphLayer = labelLayer = edgeLayer = haloLayer = hitLayer = nodeLayer = null;
  }
  if (!model) {
    displayedNodes = [];
    ui.atlasEmpty.hidden = false;
    ui.atlasEmptyTitle.textContent = t("s18");
    ui.atlasEmptyCopy.textContent = t("s19");
    updateAltText(null, []);
    return;
  }
  if (!graphLayer) {
    graphLayer = svgEl('g'); labelLayer = svgEl('g');
    edgeLayer = svgEl('g'); haloLayer = svgEl('g'); hitLayer = svgEl('g'); nodeLayer = svgEl('g');
    graphLayer.append(edgeLayer, haloLayer, hitLayer, nodeLayer);
    ui.graph.append(graphLayer); ui.labels.append(labelLayer);
  }
  const nodes = stableNodes(model);
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const connectedIds = new Set((model.edges || []).flatMap((edge) => [String(edge.source), String(edge.target)]));
  displayedNodes = ui.relationsOnly.checked ? nodes.filter((node) => connectedIds.has(String(node.id))) : nodes;
  const visibleIds = new Set(displayedNodes.map((node) => String(node.id)));
  if (selectedId && !visibleIds.has(String(selectedId))) selectedId = null;
  if (previewId && !visibleIds.has(String(previewId))) previewId = null;
  ui.atlasEmpty.hidden = displayedNodes.length > 0;
  $('empty-reset').hidden = displayedNodes.length > 0 || !hasActiveFilters();
  ui.atlasEmptyTitle.textContent = displayedNodes.length ? '' : t("s20");
  ui.atlasEmptyCopy.textContent = displayedNodes.length ? '' : (model.filterError === 'INVALID_DATE_RANGE' ? t("s21") : (ui.relationsOnly.checked ? t("s22") : t("s23")));
  if (!displayedNodes.length && ui.relationsOnly.checked && ui.relationTypes?.every((input) => !input.checked)) ui.atlasEmptyCopy.textContent = t("s24");
  const edgeKeys = new Set();
  (model.edges || []).forEach((edge) => {
    const source = byId.get(String(edge.source)); const target = byId.get(String(edge.target));
    if (!source || !target || !visibleIds.has(String(source.id)) || !visibleIds.has(String(target.id))) return;
    const key = JSON.stringify([edge.source, edge.target, edge.type]);
    edgeKeys.add(key);
    let line = edgeElements.get(key);
    if (!line) {
      line = svgEl('line'); edgeElements.set(key, line);
      edgeLayer.append(line);
    }
    Object.entries({ x1: source.x, y1: source.y, x2: target.x, y2: target.y, class: edgeClass(edge.type), 'data-edge-type': edge.type || 'relation', 'data-count': edge.count || 1, 'data-source': edge.source, 'data-target': edge.target }).forEach(([key, value]) => line.setAttribute(key, value));
  });
  for (const [key, line] of edgeElements) if (!edgeKeys.has(key)) { line.remove(); edgeElements.delete(key); }
  for (const [id, elements] of nodeElements) if (!visibleIds.has(id)) { Object.values(elements).forEach((element) => element.remove()); nodeElements.delete(id); }
  const rovingId = focusedNode?.dataset.nodeId || selectedId || displayedNodes[0]?.id;
  let arrivals = 0;
  displayedNodes.forEach((node) => {
    const id = String(node.id);
    let elements = nodeElements.get(id);
    const arriving = !elements;
    if (!elements) {
      const halo = svgEl('circle', { class: 'node-halo' });
      const hit = svgEl('circle', { r: 38, class: 'node-hit', 'aria-hidden': 'true' });
      const circle = svgEl('circle', { class: 'node', role: 'button', 'data-node-id': id });
      circle.append(svgEl('title'));
      const label = svgEl('text', { 'text-anchor': 'middle', class: 'node-label', 'data-node-id': id });
      [hit, circle].forEach((element) => {
        element.addEventListener('pointerdown', (event) => { if (event.button === 0) halo.classList.add('is-pressed'); });
        element.addEventListener('mouseenter', () => { if (hoverPointer.matches && !drag) focusNode(id, false); });
        element.addEventListener('mouseleave', clearPreview);
        element.addEventListener('click', () => commitSelection(id));
      });
      circle.addEventListener('focus', () => focusNode(id, false));
      circle.addEventListener('blur', clearPreview);
      circle.addEventListener('blur', () => halo.classList.remove('is-pressed'));
      circle.addEventListener('keyup', () => halo.classList.remove('is-pressed'));
      circle.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); halo.classList.add('is-pressed'); if (!event.repeat) commitSelection(id); return; }
        if (event.key === 'Escape') { clearSelection(); return; }
        const direction = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!direction || displayedNodes.length < 2) return;
        event.preventDefault();
        const index = displayedNodes.findIndex((entry) => String(entry.id) === id);
        const nextId = String(displayedNodes[(index + direction + displayedNodes.length) % displayedNodes.length].id);
        nodeElements.get(nextId)?.circle.focus();
      });
      haloLayer.append(halo); hitLayer.append(hit); nodeLayer.append(circle); labelLayer.append(label);
      elements = { halo, hit, circle, label }; nodeElements.set(id, elements);
    }
    const { halo, hit, circle, label } = elements;
    [halo, hit, circle].forEach((element) => { element.setAttribute('cx', node.x); element.setAttribute('cy', node.y); });
    halo.setAttribute('r', node.radius + 12);
    halo.classList.toggle('node-halo--hot', node.activityRatio >= .75);
    circle.setAttribute('r', node.radius); circle.setAttribute('fill', node.color);
    circle.setAttribute('aria-label', t("s25", { p0: nodeLabel(node), p1: fmtNum(node.messageCount || node.count), count: node.messageCount || node.count }));
    circle.setAttribute('tabindex', String(id === String(rovingId) ? 0 : -1));
    circle.querySelector('title').textContent = t("s26", { p0: nodeLabel(node), p1: fmtNum(node.messageCount || node.count), count: node.messageCount || node.count });
    label.setAttribute('x', node.x); label.setAttribute('y', node.y + node.radius + 26);
    label.textContent = nodeLabel(node).slice(0, 32);
    if (arriving && arrivals < 12) {
      // The interactive circle never changes geometry during motion.
      const delay = newArchive ? arrivals * 12 : 0;
      motion.play(circle, [{ opacity: .35 }, { opacity: 1 }], { duration: 'scene', delay });
      motion.play(label, [{ opacity: .35, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 'scene', delay });
      arrivals += 1;
    }
  });
  newArchive = false;
  updateViewport();
  updateAltText(model, displayedNodes);
  applySelection();
  if (focusedNode && !focusedNode.isConnected) (nodeElements.get(String(displayedNodes[0]?.id))?.circle || ui.atlasSvg).focus();
}

function updateViewport({ animate = false } = {}) {
  const transform = `translate(${pan.x} ${pan.y}) scale(${zoom})`;
  [graphLayer, labelLayer].forEach((layer) => {
    if (!layer) return;
    const previous = getComputedStyle(layer).transform;
    layer.setAttribute('transform', transform);
    if (animate) motion.play(layer, [{ transform: previous }, { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }], { channel: 'viewport', duration: 'state' });
  });
  if (!animate) motion.cancel('viewport');
}

function selectionSignal(id) {
  motion.cancel('selection');
  if (motion.reduced()) return;
  const node = displayedNodes.find((entry) => String(entry.id) === String(id));
  if (!node || !graphLayer) return;
  const ring = svgEl('circle', { cx: node.x, cy: node.y, r: node.radius + 8, class: 'motion-effect selection-ring', 'aria-hidden': 'true' });
  ring.style.transformOrigin = `${node.x}px ${node.y}px`;
  graphLayer.append(ring);
  motion.play(ring, [{ opacity: .65, transform: 'scale(.85)' }, { opacity: 0, transform: 'scale(1.45)' }], { channel: 'selection', duration: 'signal', cleanup: () => ring.remove() });
  // One path per neighbor, even when several relation types connect the pair.
  const neighbors = new Set();
  for (const edge of visibleModel.edges || []) {
    const neighborId = String(edge.source) === String(id) ? String(edge.target) : String(edge.target) === String(id) ? String(edge.source) : null;
    if (!neighborId || neighbors.has(neighborId)) continue;
    const target = displayedNodes.find((entry) => String(entry.id) === neighborId);
    if (!target) continue;
    neighbors.add(neighborId);
    const length = Math.hypot(target.x - node.x, target.y - node.y);
    const trace = svgEl('line', { x1: node.x, y1: node.y, x2: target.x, y2: target.y, class: 'motion-effect selection-trace', 'stroke-dasharray': length, 'aria-hidden': 'true' });
    edgeLayer.append(trace);
    motion.play(trace, [{ strokeDashoffset: length, opacity: .7 }, { strokeDashoffset: 0, opacity: .65, offset: .65 }, { strokeDashoffset: 0, opacity: 0 }], { channel: 'selection', duration: 'signal', cleanup: () => trace.remove() });
    if (neighbors.size >= 12) break;
  }
}

function updateFocus(id) {
  if (!visibleModel) return;
  const node = visibleModel.nodes.find((item) => String(item.id) === String(id));
  if (!node) return;
  const inspector = $('inspector');
  const changed = inspector.dataset.nodeId !== String(id);
  inspector.dataset.nodeId = String(id);
  const relationCount = new Set((visibleModel.edges || []).filter((edge) => String(edge.source) === String(id) || String(edge.target) === String(id)).map((edge) => String(edge.source) === String(id) ? String(edge.target) : String(edge.source))).size;
  ui.focusTitle.textContent = nodeLabel(node);
  renderNeighbors(visibleModel, String(id) === String(selectedId) ? selectedId : null, selectRelatedNode);
  if (changed && !inspector.hidden) {
    motion.play(ui.focusTitle, [{ opacity: .5, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], { channel: 'inspector' });
    motion.play(ui.focusMetrics, [{ opacity: .5 }, { opacity: 1 }], { channel: 'inspector' });
  }
  ui.focusCopy.textContent = node.type === 'participant' ? t("s27") : t("s28");
  $('focus-kind').textContent = node.type === 'participant' ? t("s29") : t("s30");
  $('inspector').hidden = !selectedId && !(document.activeElement?.matches('.node:focus-visible') && document.activeElement?.dataset.nodeId === String(id));
  ui.focusMetrics.hidden = false;
  ui.relationBreakdown.hidden = false;
  $('close-selection').hidden = !selectedId;
  ui.focusMetrics.innerHTML = t("s31", { p0: fmtNum(node.messageCount || node.count), p1: fmtNum(relationCount), p2: esc(fmtDate(node.firstDate)), p3: esc(fmtDate(node.lastDate)) });
  if (ui.relationBreakdown) {
    const counts = new Map();
    (visibleModel.edges || []).forEach((edge) => {
      if (String(edge.source) !== String(id) && String(edge.target) !== String(id)) return;
      const type = String(edge.type || 'relation');
      counts.set(type, (counts.get(type) || 0) + Number(edge.count || 1));
    });
    clear(ui.relationBreakdown);
    if (!counts.size) {
      ui.relationBreakdown.textContent = t("s32");
    } else {
      [...counts.entries()].forEach(([type, count]) => {
        const row = document.createElement('div');
        row.className = 'relation-breakdown__row';
        const label = document.createElement('span');
        label.textContent = relationNamesFor(visibleModel)[type] || t("s13");
        const value = document.createElement('strong');
        value.textContent = fmtNum(count);
        row.append(label, value);
        ui.relationBreakdown.append(row);
      });
    }
  }
}
function focusNode(id, select = false) {
  if (!visibleModel) return;
  if (select) { selectedId = String(id); previewId = null; }
  else previewId = String(id);
  updateFocus(selectedId || id);
  applySelection();
}
function commitSelection(id) {
  if (!displayedNodes.some((node) => String(node.id) === String(id))) return;
  cancelExport();
  renderVersion += 1;
  selectedId = String(id);
  previewId = null;
  updateFocus(id);
  if (ui.selectionStatus) ui.selectionStatus.textContent = t("s33", { p0: nodeLabel(visibleModel?.nodes.find((node) => String(node.id) === String(id))) });
  applySelection();
  selectionSignal(id);
}
function clearPreview() {
  if (!previewId) return;
  previewId = null;
  if (selectedId && visibleModel?.nodes.some((node) => String(node.id) === String(selectedId))) updateFocus(selectedId);
  else resetInspector();
  applySelection();
}
function selectRelatedNode(id) {
  zoom = 1; pan = { x: 0, y: 0 }; updateViewport({ animate: true }); updateScale(); renderVersion += 1;
  commitSelection(id);
  ui.focusTitle.focus({ preventScroll: true });
}
function applySelection() {
  const activeId = previewId || selectedId;
  const connected = new Set();
  if (activeId && visibleModel) (visibleModel.edges || []).forEach((edge) => { if (String(edge.source) === String(activeId)) connected.add(String(edge.target)); if (String(edge.target) === String(activeId)) connected.add(String(edge.source)); });
  ui.graph.querySelectorAll('.edge').forEach((edge) => {
    const related = !activeId || String(edge.dataset.source) === String(activeId) || String(edge.dataset.target) === String(activeId);
    edge.style.opacity = related ? '' : '.12';
  });
  ui.graph.querySelectorAll('.node').forEach((node) => {
    const related = !activeId || String(node.dataset.nodeId) === String(activeId) || connected.has(String(node.dataset.nodeId));
    node.style.opacity = related ? '' : '.3';
    node.classList.toggle('is-preview', String(node.dataset.nodeId) === String(previewId));
    node.classList.toggle('is-focus', String(node.dataset.nodeId) === String(selectedId));
    node.setAttribute('aria-pressed', String(String(node.dataset.nodeId) === String(selectedId)));
    node.setAttribute('tabindex', String(node.dataset.nodeId) === String(document.activeElement?.matches('.node') ? document.activeElement.dataset.nodeId : (selectedId || previewId || ui.graph.querySelector('.node')?.dataset.nodeId)) ? '0' : '-1');
  });
  ui.labels.querySelectorAll('.node-label').forEach((label) => {
    const related = !activeId || String(label.dataset.nodeId) === String(activeId) || connected.has(String(label.dataset.nodeId));
    label.style.opacity = related ? '' : '.3';
  });
  $('node-list').querySelectorAll('.node-row').forEach((row) => {
    const selected = String(row.dataset.nodeId) === String(selectedId);
    row.classList.toggle('is-selected', selected);
    row.setAttribute('aria-pressed', String(selected));
  });
}
function updateAltText(model, nodes) {
  if (!model) { ui.altText.textContent = t("s34"); return; }
  if (!nodes.length) { ui.altText.textContent = t("s35"); return; }
  const edges = model.edges || [];
  const top = [...nodes].sort((a, b) => Number(b.messageCount || b.count) - Number(a.messageCount || a.count)).slice(0, 6);
  const parts = [t("s36", { p0: fmtNum(nodes.length), p1: fmtNum(edges.length) })];
  parts.push(t("s37", { p0: top.map((n) => `${nodeLabel(n)} (${fmtNum(n.messageCount || n.count)})`).join(', ') }));
  const rels = edges.reduce((acc, edge) => { acc[edge.type || 'relation'] = (acc[edge.type || 'relation'] || 0) + 1; return acc; }, {});
  parts.push(t("s38", { p0: Object.entries(rels).map(([key, value]) => `${relationNamesFor(model)[key] || t("s13")}: ${value}`).join(', ') }));
  ui.altText.textContent = parts.join(' ');
}

function renderTimeline(model) {
  const focusedPeriod = document.activeElement?.closest('.timeline-point');
  const focusedFrom = focusedPeriod?.dataset.from;
  const periods = model?.periods || [];
  const nextKey = JSON.stringify(periods.map((period) => [period.start, period.end, period.count]));
  if (nextKey === timelineKey) {
    ui.timeline.querySelectorAll('[data-from]').forEach((element) => {
      const selected = element.dataset.from === ui.fromDate.value && element.dataset.to === ui.toDate.value;
      element.classList.toggle('is-selected', selected);
      if (element.matches('.timeline-point')) element.setAttribute('aria-pressed', String(selected));
    });
    return;
  }
  timelineKey = nextKey;
  motion.cancel('timeline');
  clear(ui.timeline);
  if (!periods.length) {
    ui.timelineRange.textContent = '-';
    ui.timelineEmpty.hidden = false;
    ui.timelineEmpty.textContent = model ? t("s39") : t("s40");
    return;
  }
  ui.timelineEmpty.hidden = true;
  ui.timelineRange.textContent = `${shortDate(periods[0].start)} / ${shortDate(periods.at(-1).end || periods.at(-1).start)}`;
  const peak = Math.max(...periods.map((period) => Number(period.count || 1)), 1);
  const step = 1120 / periods.length;
  const barWidth = Math.min(100, step * .64);
  ui.timeline.append(svgEl('line', { x1: 40, y1: 124, x2: 1160, y2: 124, class: 'timeline-axis' }));
  periods.forEach((period, index) => {
    const x = 40 + (index + .5) * step;
    const ratio = Number(period.count || 1) / peak;
    const height = 24 + ratio * 76;
    const from = shortDate(period.start);
    const to = shortDate(period.end || period.start);
    const selected = ui.fromDate.value === from && ui.toDate.value === to;
    ui.timeline.append(svgEl('rect', { x: x - barWidth / 2, y: 124 - height, width: barWidth, height, rx: 8, class: `timeline-bar${ratio > .7 ? ' is-peak' : ''}${selected ? ' is-selected' : ''}`, 'data-from': from, 'data-to': to }));
    const point = svgEl('rect', {
      x: x - step * .47, y: 8, width: step * .94, height: 122, rx: 10,
      class: `timeline-point${ratio > .7 ? ' is-peak' : ''}${selected ? ' is-selected' : ''}`,
      role: 'button', tabindex: '0', 'aria-pressed': String(selected),
      'aria-label': t("s41", { p0: from, p1: to, p2: fmtNum(period.count), count: period.count }),
      'data-from': from, 'data-to': to,
    });
    point.addEventListener('click', () => selectPeriod(from, to));
    point.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); selectPeriod(from, to);
    });
    ui.timeline.append(point);
    if (index % Math.max(1, Math.ceil(periods.length / 8)) === 0) {
      const label = svgEl('text', { x, y: 157, 'text-anchor': 'middle', class: 'timeline-label' });
      label.textContent = new Date(period.start).toLocaleDateString(localeTag(), { month: 'short', timeZone: 'UTC' }).replace('.', '');
      ui.timeline.append(label);
    }
  });
  if (focusedFrom) (ui.timeline.querySelector(`.timeline-point[data-from="${CSS.escape(focusedFrom)}"]`) || ui.timeline.querySelector('.timeline-point'))?.focus();
}
function selectPeriod(from, to) {
  if (!sourceModel) return;
  const same = ui.fromDate.value === from && ui.toDate.value === to;
  ui.fromDate.value = same ? '' : (from || '');
  ui.toDate.value = same ? '' : (to || '');
  selectedId = null;
  previewId = null;
  render();
  const bar = ui.timeline.querySelector(`.timeline-bar[data-from="${CSS.escape(from)}"]`);
  motion.play(bar, [{ transform: 'scaleY(.86)' }, { transform: 'scaleY(1)' }], { channel: 'timeline', duration: 'scene' });
}
function render() {
  cancelExport();
  endPan();
  renderVersion += 1;
  try {
    visibleModel = currentFilteredModel();
  } catch (error) {
    visibleModel = null;
    previewId = null;
    selectedId = null;
    renderGraph(null);
    renderTimeline(null);
    resetInspector();
    setStatus(error.userMessage || error.message || t("s42"), true);
    return;
  }
  setDatasetLabel(visibleModel);
  renderSliceSummary(visibleModel);
  if (visibleModel?.filterError === 'INVALID_DATE_RANGE') setStatus(t("s21"), true);
  else if (ui.status.classList.contains('is-error')) setStatus(t("s43"));
  renderGraph(visibleModel);
  renderTimeline(currentFilteredModel({ includeDates: false }));
  syncWorkspace();
  if (selectedId && visibleModel?.nodes.some((n) => String(n.id) === String(selectedId))) updateFocus(selectedId);
  else if (previewId) updateFocus(previewId);
  else { selectedId = null; resetInspector(); }
}
function resetInspector() {
  motion.cancel('inspector');
  delete $('inspector').dataset.nodeId;
  renderNeighbors(null, null);
  const hasVisibleNodes = Boolean(visibleModel?.nodes?.length);
  ui.focusTitle.textContent = hasVisibleNodes ? t("s44") : (sourceModel ? t("s45") : t("s44"));
  ui.focusCopy.textContent = hasVisibleNodes ? t("s46") : (sourceModel ? t("s23") : t("s46"));
  $('focus-kind').textContent = t("s47");
  $('close-selection').hidden = true;
  $('inspector').hidden = true;
  ui.focusMetrics.hidden = true;
  ui.relationBreakdown.hidden = true;
  ui.focusMetrics.innerHTML = t("s48");
  if (ui.relationBreakdown) ui.relationBreakdown.textContent = t("s49");
}

function updateScale() { ui.scale.textContent = t("s50", { p0: zoom.toFixed(1) }); ui.zoomReset.textContent = `${zoom.toFixed(1)}×`; }
function resetView() { cancelExport(); endPan(); zoom = 1; pan = { x: 0, y: 0 }; updateScale(); updateViewport({ animate: true }); renderVersion += 1; clearSelection(); }
function applyModel(model, { demo = false } = {}) {
  const nextModel = model?.model || model;
  previewId = null;
  newArchive = true;
  layoutCache.clear();
  if (!nextModel || !Array.isArray(nextModel.nodes) || !nextModel.nodes.length) throw new Error(t("s51"));
  sourceModel = nextModel;
  ui.selectionStatus.textContent = '';
  isDemo = demo;
  $('node-search').value = '';
  activeFileName = pendingFileName || activeFileName;
  pendingFileName = '';
  populateControls(sourceModel);
  $('filters-panel').open = false;
  if (demo) ui.viewMode.value = 'participants';
  zoom = 1; pan = { x: 0, y: 0 }; selectedId = null; updateScale();
  setEnabled(true); render(); setStatus(t("s52", { p0: fmtNum(sourceModel.stats?.messageCount || sourceModel.nodes.reduce((sum, n) => sum + Number(n.messageCount || n.count || 0), 0)), count: sourceModel.stats?.messageCount }));
}
function parseAndRender(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(t("s53")); }
  const result = parseExport(parsed, {
    onProgress: ({ phase, ratio }) => {
      if (phase === 'normalizing') {
        const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
        ui.progressLabel.textContent = t("s54"); setProgress(pct);
      }
    }
  });
  applyModel(result);
}
function cancelImport({ announce = true } = {}) {
  cancelExport();
  clearTimeout(progressTimer);
  const wasImporting = Boolean(activeReader || activeWorker || (ui.progressWrap && !ui.progressWrap.hidden));
  importToken += 1;
  if (activeReader) { try { activeReader.abort(); } catch { /* already finished */ } activeReader = null; }
  if (activeWorker) { try { activeWorker.terminate(); } catch { /* already finished */ } activeWorker = null; }
  if (ui.progressWrap) ui.progressWrap.hidden = true;
  setImporting(false);
  pendingFileName = '';
  if (announce && wasImporting) setStatus(sourceModel ? t("s55") : t("s56"));
}
function readFile(file) {
  if (!file) return;
  cancelImport({ announce: false });
  if (file.size > 250 * 1024 * 1024) { finishImportError(t("s57")); return; }
  pendingFileName = file.name || '';
  const token = importToken;
  ui.progressWrap.hidden = false; setProgress(0); ui.progressLabel.textContent = t("s58"); setImporting(true); setStatus(t("s59"));
  let worker = null;
  if (typeof Worker === 'function') {
    try { worker = new Worker('./import-worker.js', { type: 'module' }); } catch { worker = null; }
  }
  if (worker) {
    activeWorker = worker;
    worker.onmessage = (event) => {
      if (token !== importToken) { worker.terminate(); return; }
      const payload = event.data || {};
      if (payload.type === 'progress') { ui.progressLabel.textContent = translateMessage(payload.label) || t("s60"); setProgress(payload.percent || 0); return; }
      activeWorker = null; worker.terminate();
      if (payload.type === 'error') { finishImportError(translateMessage(payload.message) || t("s1")); return; }
      try { applyModel(payload.model); setImporting(false); setProgress(100); ui.progressLabel.textContent = t("s61"); progressTimer = setTimeout(() => { if (token === importToken) ui.progressWrap.hidden = true; }, 700); }
      catch (error) { finishImportError(error.userMessage || error.message || t("s1")); }
    };
    worker.onerror = () => { if (token !== importToken) return; finishImportError(t("s62")); };
    const reader = new FileReader(); activeReader = reader;
    reader.onprogress = (event) => { if (token !== importToken || !event.lengthComputable) return; const pct = Math.round(event.loaded / event.total * 100); ui.progressLabel.textContent = t("s58"); setProgress(pct); };
    reader.onerror = () => { if (token !== importToken) return; finishImportError(t("s63")); };
    reader.onabort = () => { if (token === importToken) { activeReader = null; ui.progressWrap.hidden = true; setImporting(false); } };
    reader.onload = () => { if (token === importToken) { activeReader = null; worker.postMessage({ buffer: reader.result, locale: getLocale() }, [reader.result]); } };
    reader.readAsArrayBuffer(file);
    return;
  }
  const reader = new FileReader();
  activeReader = reader;
  reader.onprogress = (event) => { if (token !== importToken || !event.lengthComputable) return; const pct = Math.round(event.loaded / event.total * 100); setProgress(pct); };
  reader.onerror = () => { if (token !== importToken) return; finishImportError(t("s63")); };
  reader.onabort = () => { if (token === importToken) { activeReader = null; ui.progressWrap.hidden = true; setImporting(false); } };
  reader.onload = () => {
    if (token !== importToken) return;
    activeReader = null;
    try { parseAndRender(String(reader.result)); setImporting(false); setProgress(100); ui.progressLabel.textContent = t("s61"); progressTimer = setTimeout(() => { if (token === importToken) ui.progressWrap.hidden = true; }, 700); }
    catch (error) { finishImportError(error.userMessage || error.message || t("s1")); }
  };
  reader.readAsText(file);
}

function clearData() {
  ui.relationTypes.forEach((input) => { input.checked = true; });
  cancelImport({ announce: false });
  ui.selectionStatus.textContent = '';
  sourceModel = null; visibleModel = null; selectedId = null; previewId = null; activeFileName = ''; pendingFileName = ''; ui.file.value = ''; ui.datasetLabel.textContent = t("s5"); setEnabled(false);
  ui.chatFilter.innerHTML = t("s64"); ui.personFilter.innerHTML = t("s65"); ui.fromDate.value = ''; ui.toDate.value = ''; ui.fromDate.min = ''; ui.fromDate.max = ''; ui.toDate.min = ''; ui.toDate.max = '';
  ui.viewMode.value = 'auto'; ui.relationsOnly.checked = false; isDemo = false; $('node-search').value = '';
  newArchive = false; layoutCache.clear(); motion.cancelAll(); cancelExport(); endPan(); ui.progressWrap.hidden = true; setProgress(0); setStatus(t("s66")); zoom = 1; pan = { x: 0, y: 0 }; updateScale(); resetInspector(); renderSliceSummary(null); updateAltText(null, []); renderGraph(null); renderTimeline(null); syncWorkspace();
}
function download(name, type, body) { const blob = body instanceof Blob ? body : new Blob([body], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function exportableSvg() {
  const clone = ui.atlasSvg.cloneNode(true);
  [clone, ...clone.querySelectorAll('*')].forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      if (attribute.name.startsWith('aria-') || attribute.name === 'role' || attribute.name === 'tabindex' || attribute.name.startsWith('data-')) element.removeAttribute(attribute.name);
    });
  });
  clone.querySelectorAll('.node-hit, .motion-effect').forEach((element) => element.remove());
  clone.removeAttribute('tabindex'); clone.removeAttribute('aria-labelledby'); clone.setAttribute('xmlns', NS); clone.setAttribute('viewBox', '0 0 1000 610');
  const style = document.createElementNS(NS, 'style');
  style.textContent = `
    .grid-dot{fill:#b8c9df;opacity:.48}
    .edge{fill:none;stroke:#a7b9d2;stroke-opacity:.55;stroke-width:1.3}.edge--reply{stroke:#d49482}.edge--mention{stroke:#7a9fcd}.edge--shared{stroke:#8b9fbc;stroke-dasharray:4 5}.edge--time{stroke:#aebed4;stroke-dasharray:1 5}
    .node-halo{fill:#5189ce;opacity:.07}.node-halo--hot{fill:#e78068}.node{stroke:#fff;stroke-width:3}.node.is-focus{stroke:#376cc5;stroke-width:4}.node-label{fill:#4a5b73;font-family:sans-serif;font-size:13px;paint-order:stroke;stroke:#f9fbfe;stroke-width:5px;stroke-linejoin:round}`;
  clone.insertBefore(style, clone.firstChild);
  const background = document.createElementNS(NS, 'rect'); background.setAttribute('width', '1000'); background.setAttribute('height', '610'); background.setAttribute('fill', '#f9fbfe'); clone.insertBefore(background, clone.children[1] || null);
  return clone;
}
function exportFeedback(button, success = true) {
  clearTimeout(exportFeedbackTimers.get(button));
  button.dataset.result = success ? 'success' : 'error';
  button.querySelector('span').textContent = success ? '✓' : '!';
  exportFeedbackTimers.set(button, setTimeout(() => {
    delete button.dataset.result; button.querySelector('span').textContent = '↓'; exportFeedbackTimers.delete(button);
  }, 1000));
}
function cancelExport() {
  if (exportJob) {
    exportJob.image.onload = exportJob.image.onerror = null;
    exportJob = null;
    ui.exportPng.setAttribute('aria-busy', 'false');
    ui.exportPng.querySelector('span').textContent = '↓';
    ui.exportPng.disabled = !displayedNodes.length;
    setStatus(t("s67"));
  }
  for (const [button, timer] of exportFeedbackTimers) {
    clearTimeout(timer); delete button.dataset.result; button.querySelector('span').textContent = '↓';
  }
  exportFeedbackTimers.clear();
}
function exportSvg() {
  if (!displayedNodes.length) return;
  try {
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(exportableSvg())}`;
    download('telegram-constellation.svg', 'image/svg+xml;charset=utf-8', source);
    exportFeedback(ui.exportSvg);
    setStatus(t("s68"));
  } catch { exportFeedback(ui.exportSvg, false); setStatus(t("s69"), true); }
}
function exportPng() {
  if (!displayedNodes.length || exportJob) return;
  const token = importToken;
  const version = renderVersion;
  const source = new XMLSerializer().serializeToString(exportableSvg()); const image = new Image();
  const job = { image };
  exportJob = job;
  ui.exportPng.setAttribute('aria-busy', 'true'); ui.exportPng.disabled = true;
  ui.exportPng.querySelector('span').textContent = '…';
  setStatus(t("s70"));
  const current = () => exportJob === job && token === importToken && version === renderVersion && visibleModel;
  const finish = (success) => {
    exportJob = null; image.onload = image.onerror = null;
    ui.exportPng.setAttribute('aria-busy', 'false'); ui.exportPng.disabled = !displayedNodes.length;
    exportFeedback(ui.exportPng, success);
    setStatus(success ? t("s71") : t("s72"), !success);
  };
  image.onload = () => {
    if (!current()) return;
    try {
      const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = 1220; const ctx = canvas.getContext('2d'); if (!ctx) { finish(false); return; }
      ctx.fillStyle = '#f9fbfe'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!current()) return;
        if (!blob) { finish(false); return; }
        download('telegram-constellation.png', 'image/png', blob); finish(true);
      });
    } catch { finish(false); }
  };
  image.onerror = () => { if (current()) finish(false); };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

function zoomAt(nextZoom, event = null) {
  const next = Math.max(.65, Math.min(2.8, nextZoom));
  if (next === zoom) return;
  let anchor = { x: 500, y: 305 };
  if (event && ui.atlasSvg) anchor = svgPoint(event.clientX, event.clientY);
  const ratio = next / zoom;
  pan.x = anchor.x - (anchor.x - pan.x) * ratio;
  pan.y = anchor.y - (anchor.y - pan.y) * ratio;
  cancelExport();
  zoom = next; updateScale();
  if (visibleModel) { updateViewport({ animate: !event }); renderVersion += 1; } else render();
}
function svgPoint(clientX, clientY) {
  try {
    const point = ui.atlasSvg.createSVGPoint(); point.x = clientX; point.y = clientY;
    const matrix = ui.atlasSvg.getScreenCTM()?.inverse(); if (matrix) { const transformed = point.matrixTransform(matrix); return { x: transformed.x, y: transformed.y }; }
  } catch { /* fallback below */ }
  const rect = ui.atlasSvg.getBoundingClientRect();
  return { x: rect.width ? (clientX - rect.left) / rect.width * 1000 : 500, y: rect.height ? (clientY - rect.top) / rect.height * 610 : 305 };
}

function renderExplorer() {
  const query = $('node-search').value.trim().toLocaleLowerCase(localeTag());
  const nodes = [...displayedNodes].sort((a, b) => Number(b.messageCount) - Number(a.messageCount));
  const list = $('node-list');
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const existing = new Map([...list.children].map((row) => [row.dataset.nodeId, row]));
  $('node-count').textContent = fmtNum(nodes.length);
  const found = nodes.filter((node) => nodeLabel(node).toLocaleLowerCase(localeTag()).includes(query));
  const foundIds = new Set(found.map((node) => String(node.id)));
  for (const [id, row] of existing) if (!foundIds.has(id)) row.remove();
  $('node-list-empty').hidden = Boolean(found.length) || !sourceModel;
  $('node-list-empty').textContent = nodes.length ? t("s73") : t("s74");
  const max = Math.max(...nodes.map((node) => Number(node.messageCount)), 1);
  found.forEach((node, index) => {
    const id = String(node.id);
    let row = existing.get(id);
    if (!row) {
      row = document.createElement('button'); row.type = 'button'; row.className = 'node-row'; row.dataset.nodeId = id;
      const avatar = document.createElement('span'); avatar.className = 'node-avatar'; avatar.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.className = 'node-name';
      const count = document.createElement('span'); count.className = 'node-value';
      row.append(avatar, name, count);
      row.addEventListener('click', () => {
        cancelExport();
        zoom = 1; pan = { x: 0, y: 0 }; updateViewport({ animate: true }); updateScale(); renderVersion += 1;
        commitSelection(id);
        if (matchMedia('(max-width: 650px)').matches) $('inspector').scrollIntoView({ behavior: motion.reduced() ? 'instant' : 'smooth', block: 'center' });
      });
    }
    row.classList.toggle('is-active', Number(node.messageCount) / max >= .75);
    row.setAttribute('aria-label', t("s75", { p0: nodeLabel(node), p1: fmtNum(node.messageCount), count: node.messageCount }));
    row.querySelector('.node-avatar').textContent = nodeLabel(node).slice(0, 1);
    row.querySelector('.node-name').textContent = nodeLabel(node);
    row.querySelector('.node-name').title = nodeLabel(node);
    row.querySelector('.node-value').textContent = fmtNum(node.messageCount);
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
  });
  if (focused && document.activeElement !== focused) (focused.isConnected ? focused : list.firstElementChild || $('node-search')).focus({ preventScroll: true });
  applySelection();
}

function syncWorkspace() {
  renderImportNotes(sourceModel);
  const relationLabels = relationNamesFor(visibleModel);
  ui.relationTypes.forEach((input) => { input.closest('label').lastElementChild.textContent = relationLabels[input.dataset.relationType]; });
  $('relation-filter-help').textContent = relationLabels.shared === t("s76") ? t("s77") : t("s78");
  document.querySelector('#legend-dialog .legend-line--shared').nextElementSibling.textContent = relationLabels.shared;
  const loaded = Boolean(sourceModel);
  document.body.classList.toggle('has-data', loaded);
  ['workspace-heading', 'workspace-content', 'filters-panel', 'explorer-panel'].forEach((id) => { $(id).hidden = !loaded; });
  $('welcome').hidden = loaded;
  document.querySelector('.start-actions').hidden = loaded;
  document.querySelector('.archive-actions').hidden = !loaded;
  $('demo-banner').hidden = !loaded || !isDemo;
  $('import-heading').textContent = loaded ? (isDemo ? t("s79") : t("s80")) : t("s81");
  document.querySelector('.dropzone__title').textContent = loaded ? t("s82") : t("s83");
  const isParticipants = visibleModel?.nodes?.[0]?.type === 'participant' || (ui.viewMode.value === 'participants') || (ui.viewMode.value === 'auto' && sourceModel?.chatNodes?.length === 1);
  $('mode-chats').setAttribute('aria-pressed', String(!isParticipants));
  $('mode-participants').setAttribute('aria-pressed', String(isParticipants));
  updateModeIndicator();
  $('mode-chats').disabled = !loaded; $('mode-participants').disabled = !loaded;
  $('stat-messages').textContent = fmtNum(visibleModel?.stats?.messageCount);
  $('stat-nodes').textContent = fmtNum(displayedNodes.length);
  $('stat-node-type').textContent = pluralRu(displayedNodes.length, isParticipants ? [t("s29"), t("s84"), t("s85")] : [t("s30"), t("s86"), t("s87")]);
  $('stat-relations').textContent = fmtNum(visibleModel?.edges?.length);
  const filterCount = [ui.chatFilter.value !== 'all', ui.personFilter.value !== 'all', Boolean(ui.fromDate.value || ui.toDate.value), ui.relationsOnly.checked, ui.relationTypes.some((input) => !input.checked)].filter(Boolean).length;
  $('filter-count').hidden = !filterCount; $('filter-count').textContent = filterCount;
  $('reset-period').hidden = !ui.fromDate.value && !ui.toDate.value;
  ui.exportSvg.disabled = !displayedNodes.length; ui.exportPng.disabled = !displayedNodes.length;
  renderExplorer();
}
function openDemo() {
  cancelImport({ announce: false });
  pendingFileName = t("s88");
  applyModel(parseExport(createDemoExport()), { demo: true });
  setStatus(t("s89"));
}
function clearSelection() {
  motion.cancel('selection');
  cancelExport();
  renderVersion += 1;
  selectedId = null; previewId = null; resetInspector(); applySelection();
  ui.selectionStatus.textContent = t("s90");
}
function updateMapBounds() {
  if (matchMedia('(max-width: 650px)').matches) {
    ui.atlasSvg.setAttribute('viewBox', '100 20 740 560');
  } else {
    ui.atlasSvg.setAttribute('viewBox', '0 0 1000 610');
  }
  updateModeIndicator();
}
function updateModeIndicator() {
  const active = document.querySelector('.mode-switch [aria-pressed="true"]');
  if (!active || !active.offsetWidth) return;
  active.parentElement.style.setProperty('--mode-x', `${active.offsetLeft}px`);
  active.parentElement.style.setProperty('--mode-width', `${active.offsetWidth}px`);
}

function endPan() {
  if (drag && ui.atlasSvg.hasPointerCapture(drag.pointerId)) ui.atlasSvg.releasePointerCapture(drag.pointerId);
  drag = null;
  ui.atlasSvg.classList.remove('is-panning');
}
function releaseNodePress() { ui.graph.querySelectorAll('.node-halo.is-pressed').forEach((halo) => halo.classList.remove('is-pressed')); }
function wireWorkspace() {
  ui.relationTypes.forEach((input) => input.addEventListener('change', () => { previewId = null; render(); }));
  updateMapBounds();
  window.addEventListener('resize', updateMapBounds);
  $('open-demo').addEventListener('click', openDemo);
  $('demo-upload').addEventListener('click', () => ui.file.click());
  $('node-search').addEventListener('input', renderExplorer);
  $('empty-reset').addEventListener('click', resetFilters);
  $('close-selection').addEventListener('click', clearSelection);
  $('reset-period').addEventListener('click', () => { ui.fromDate.value = ''; ui.toDate.value = ''; selectedId = null; previewId = null; render(); });
  ['chats', 'participants'].forEach((mode) => $('mode-' + mode).addEventListener('click', () => { if ($('mode-' + mode).getAttribute('aria-pressed') === 'true') return; ui.viewMode.value = mode; selectedId = null; previewId = null; render(); }));
  $('open-help').addEventListener('click', () => $('help-dialog').showModal());
  $('open-legend').addEventListener('click', () => $('legend-dialog').showModal());
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => $(button.dataset.closeDialog).close()));
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) clearSelection();
  });
}

function wire() {
  ui.file.addEventListener('change', (event) => readFile(event.target.files[0]));
  let dropDepth = 0;
  const acceptsFile = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  ui.dropzone.addEventListener('dragenter', (event) => {
    if (!acceptsFile(event)) return;
    event.preventDefault(); dropDepth += 1; ui.dropzone.classList.add('is-dragging');
  });
  ui.dropzone.addEventListener('dragover', (event) => {
    if (!acceptsFile(event)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  });
  ui.dropzone.addEventListener('dragleave', (event) => {
    event.preventDefault(); dropDepth = Math.max(0, dropDepth - 1);
    if (!dropDepth) ui.dropzone.classList.remove('is-dragging');
  });
  ui.dropzone.addEventListener('drop', (event) => {
    event.preventDefault(); dropDepth = 0; ui.dropzone.classList.remove('is-dragging');
    readFile(event.dataTransfer?.files[0]);
  });
  ui.dropzone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); ui.file.click(); } });
  ui.cancelImport?.addEventListener('click', () => cancelImport());
  [ui.viewMode, ui.relationsOnly, ui.chatFilter, ui.personFilter, ui.fromDate, ui.toDate].forEach((el) => el.addEventListener('change', () => { selectedId = null; previewId = null; render(); }));
  ui.resetView.addEventListener('click', resetView); ui.resetFilters?.addEventListener('click', resetFilters); ui.clearData.addEventListener('click', clearData); ui.exportSvg.addEventListener('click', exportSvg); ui.exportPng.addEventListener('click', exportPng);
  ui.zoomOut.addEventListener('click', () => zoomAt(zoom * .85)); ui.zoomIn.addEventListener('click', () => zoomAt(zoom * 1.18)); ui.zoomReset.addEventListener('click', resetView);
  ui.atlasSvg.addEventListener('wheel', (event) => { if (!sourceModel) return; event.preventDefault(); zoomAt(zoom * (event.deltaY > 0 ? .9 : 1.1), event); }, { passive: false });
  ui.atlasSvg.addEventListener('pointerdown', (event) => {
    if (!sourceModel || event.button !== 0 || drag || event.target.closest('.node, .node-hit')) return;
    cancelExport(); motion.cancel('viewport'); motion.cancel('selection'); clearPreview();
    drag = { point: svgPoint(event.clientX, event.clientY), panX: pan.x, panY: pan.y, pointerId: event.pointerId };
    ui.atlasSvg.classList.add('is-panning');
    ui.atlasSvg.setPointerCapture(event.pointerId);
  });
  ui.atlasSvg.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = svgPoint(event.clientX, event.clientY);
    pan.x = drag.panX + point.x - drag.point.x; pan.y = drag.panY + point.y - drag.point.y;
    updateViewport(); renderVersion += 1;
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => ui.atlasSvg.addEventListener(name, (event) => { if (drag?.pointerId === event.pointerId) endPan(); }));
  ui.atlasSvg.addEventListener('keydown', (event) => { if (event.key === 'Escape') endPan(); });
  window.addEventListener('blur', endPan);
  ['pointerup', 'pointercancel', 'blur', 'pagehide'].forEach((name) => window.addEventListener(name, releaseNodePress));
  window.addEventListener('pagehide', () => { cancelImport({ announce: false }); cancelExport(); endPan(); motion.cancelAll(); });
}

mountLocale(previous => {
  const status = ui.status.textContent;
  if (sourceModel) {
    if (isDemo) { sourceModel = parseExport(createDemoExport()); activeFileName = t('s88'); }
    timelineKey = null;
    render();
    ui.chatFilter.options[0].textContent = t('s3');
    ui.personFilter.options[0].textContent = t('s4');
  } else syncWorkspace();
  updateScale();
  ui.status.textContent = translateMessage(status, previous);
});
buildGrid(); wire(); wireWorkspace(); setEnabled(false); setImporting(false); syncWorkspace();
