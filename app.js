import { parseExport, filterModel } from './app-data.js';

const $ = (id) => document.getElementById(id);
const ui = {
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
let animateNextRender = false;
let introTimer = null;
let importToken = 0;
let renderVersion = 0;
let graphLayer = null;
let labelLayer = null;

const NS = 'http://www.w3.org/2000/svg';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtNum = (value) => new Intl.NumberFormat('ru-RU').format(Number(value || 0));
const pluralRu = (value, forms) => { const n = Math.abs(Number(value || 0)); const index = n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2; return forms[index]; };
const fmtDate = (value) => { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }); };
const shortDate = (value) => { if (!value) return ''; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toISOString().slice(0, 10); };
const nodeLabel = (node) => node?.label || node?.name || 'без имени';

function setStatus(message, error = false) { ui.status.textContent = message; ui.status.classList.toggle('is-error', error); }
function setEnabled(enabled) {
  [ui.viewMode, ui.relationsOnly, ui.resetView, ui.resetFilters, ui.clearData, ui.chatFilter, ui.personFilter, ui.fromDate, ui.toDate, ui.exportSvg, ui.exportPng, ui.zoomIn, ui.zoomOut, ui.zoomReset].forEach((el) => { if (el) el.disabled = !enabled; });
}
function setImporting(importing) {
  if (!ui.cancelImport) return;
  ui.cancelImport.hidden = !importing;
  ui.cancelImport.disabled = !importing;
  ui.cancelImport.setAttribute('aria-busy', importing ? 'true' : 'false');
}

function finishImportError(message) {
  importToken += 1;
  if (activeReader) { try { activeReader.abort(); } catch { /* already finished */ } }
  if (activeWorker) { try { activeWorker.terminate(); } catch { /* already finished */ } }
  activeReader = null;
  activeWorker = null;
  pendingFileName = '';
  if (ui.progressWrap) ui.progressWrap.hidden = true;
  setProgress(0);
  setImporting(false);
  const safeMessage = String(message || 'формат файла не распознан.');
  setStatus(sourceModel ? 'импорт не завершён. текущая карта сохранена. ' + safeMessage : safeMessage, true);
}
function setProgress(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  ui.progressBar.style.width = `${value}%`;
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
  addOptions(ui.chatFilter, model.chats, 'все чаты');
  addOptions(ui.personFilter, model.participants, 'все участники');
  ui.chatFilter.value = 'all'; ui.personFilter.value = 'all'; ui.fromDate.value = ''; ui.toDate.value = '';
  ui.fromDate.min = ''; ui.fromDate.max = ''; ui.toDate.min = ''; ui.toDate.max = '';
  ui.viewMode.value = 'auto'; ui.relationsOnly.checked = false;
  const allDates = (model.periods || []).flatMap((p) => [p.start, p.end]).filter(Boolean).sort();
  if (allDates.length) { const first = shortDate(allDates[0]); const last = shortDate(allDates.at(-1)); ui.fromDate.min = first; ui.fromDate.max = last; ui.toDate.min = first; ui.toDate.max = last; }
  setDatasetLabel(model);
}
function setDatasetLabel(model) {
  if (!model) { ui.datasetLabel.textContent = 'файл не выбран'; return; }
  const count = model.stats?.messageCount || model.nodes?.reduce((sum, n) => sum + Number(n.messageCount || 0), 0) || 0;
  const filePrefix = activeFileName ? activeFileName + ' · ' : '';
  ui.datasetLabel.textContent = filePrefix + `${fmtNum(count)} ${pluralRu(count, ['сообщение', 'сообщения', 'сообщений'])} · ${fmtNum(model.nodes?.length || 0)} ${pluralRu(model.nodes?.length || 0, ['узел', 'узла', 'узлов'])}`;
}

function currentFilteredModel() {
  if (!sourceModel) return null;
  const mode = ui.viewMode.value;
  const filters = { chatId: ui.chatFilter.value, participantId: ui.personFilter.value, from: ui.fromDate.value, to: ui.toDate.value, mode };
  return filterModel ? filterModel(sourceModel, filters) : sourceModel;
}

function hasActiveFilters() {
  return Boolean(
    ui.chatFilter.value !== 'all'
    || ui.personFilter.value !== 'all'
    || ui.fromDate.value
    || ui.toDate.value
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
    fmtNum(stats.messageCount || 0) + ' ' + pluralRu(stats.messageCount || 0, ['сообщение', 'сообщения', 'сообщений']),
    fmtNum(model.nodes?.length || 0) + ' ' + pluralRu(model.nodes?.length || 0, ['узел', 'узла', 'узлов']),
    fmtNum(model.edges?.length || 0) + ' ' + pluralRu(model.edges?.length || 0, ['связь', 'связи', 'связей']),
  ];
  if (ui.fromDate.value || ui.toDate.value) parts.push((ui.fromDate.value || '…') + ' — ' + (ui.toDate.value || '…'));
  ui.sliceSummary.textContent = parts.join(' · ');
  ui.sliceStatus.textContent = hasActiveFilters() ? 'активный срез: ' + parts.join(' · ') : '';
  if (ui.resetFilters) ui.resetFilters.disabled = !hasActiveFilters();
}

function resetFilters() {
  if (!sourceModel) return;
  ui.chatFilter.value = 'all';
  ui.personFilter.value = 'all';
  ui.fromDate.value = '';
  ui.toDate.value = '';
  ui.relationsOnly.checked = false;
  selectedId = null;
  previewId = null;
  render();
}

function buildGrid() {
  clear(ui.grid);
  for (let x = 0; x <= 1000; x += 100) ui.grid.append(svgEl('line', { x1: x, y1: 0, x2: x, y2: 610, class: x === 500 ? 'grid-axis' : 'grid-line' }));
  for (let y = 0; y <= 600; y += 100) ui.grid.append(svgEl('line', { x1: 0, y1: y, x2: 1000, y2: y, class: y === 300 ? 'grid-axis' : 'grid-line' }));
  [[30, 30], [970, 30], [30, 580], [970, 580]].forEach(([x, y]) => ui.grid.append(svgEl('circle', { cx: x, cy: y, r: 2, fill: '#10212B', opacity: '.55' })));
}

function placeNodes(nodes) {
  const list = nodes || [];
  if (!list.length) return [];
  const max = Math.max(...list.map((n) => Number(n.messageCount || n.count || 1)), 1);
  const center = { x: 500, y: 300 };
  const spread = Math.min(255, 120 + list.length * 14);
  return list.map((node, index) => {
    const angle = (index / Math.max(list.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const ring = spread * (0.58 + ((index * 37) % 100) / 210);
    const activity = Number(node.activity ?? node.messageCount ?? node.count ?? 1);
    const radius = 6 + Math.sqrt(Math.max(activity, 1) / max) * 19;
    const color = node.color || (activity / max >= .75 ? '#C45236' : '#2F5D8A');
    return { ...node, x: Number.isFinite(node.x) ? node.x : center.x + Math.cos(angle) * ring, y: Number.isFinite(node.y) ? node.y : center.y + Math.sin(angle) * ring, radius, color, activityRatio: activity / max };
  });
}
function edgeClass(type) { return `edge edge--${String(type || 'time').toLowerCase()}`; }

function renderGraph(model) {
  clear(ui.graph); clear(ui.labels);
  graphLayer = null; labelLayer = null;
  if (!model) {
    ui.atlasEmpty.hidden = false;
    ui.atlasEmptyTitle.textContent = 'здесь появится карта вашего архива';
    ui.atlasEmptyCopy.textContent = 'загрузите локальный экспорт, чтобы увидеть связи и периоды.';
    ui.atlasFrame.classList.remove('is-ready');
    updateAltText(null, []);
    return;
  }
  const shouldAnimate = animateNextRender;
  if (!shouldAnimate) ui.atlasFrame.classList.remove('is-ready');
  const nodes = placeNodes(model.nodes);
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const relationsOnly = ui.relationsOnly.checked;
  const connectedIds = new Set((model.edges || []).flatMap((edge) => [String(edge.source), String(edge.target)]));
  const displayNodes = relationsOnly ? nodes.filter((node) => connectedIds.has(String(node.id))) : nodes;
  if (selectedId && !displayNodes.some((node) => String(node.id) === String(selectedId))) selectedId = null;
  if (previewId && !displayNodes.some((node) => String(node.id) === String(previewId))) previewId = null;
  ui.atlasEmpty.hidden = displayNodes.length > 0;
  ui.atlasEmptyTitle.textContent = displayNodes.length ? '' : 'в этом срезе нет точек';
  ui.atlasEmptyCopy.textContent = displayNodes.length ? '' : (model.filterError === 'INVALID_DATE_RANGE' ? 'дата начала позже даты окончания. измените границы периода.' : (relationsOnly ? 'в выбранном срезе нет связей. отключите режим «только связи» или измените фильтры.' : 'измените фильтры, чтобы вернуть точки на карту.'));
  if (!displayNodes.length) ui.atlasFrame.classList.remove('is-ready');
  const layer = svgEl('g', { transform: `translate(${pan.x} ${pan.y}) scale(${zoom})` });
  const labelsGroup = svgEl('g', { transform: `translate(${pan.x} ${pan.y}) scale(${zoom})` });
  (model.edges || []).forEach((edge) => {
    const source = byId.get(String(edge.source)); const target = byId.get(String(edge.target));
    if (!source || !target) return;
    const line = svgEl('line', { x1: source.x, y1: source.y, x2: target.x, y2: target.y, class: edgeClass(edge.type), 'data-edge-type': edge.type || 'relation', 'data-count': edge.count || 1, 'data-source': edge.source, 'data-target': edge.target });
    if (selectedId && String(edge.source) !== String(selectedId) && String(edge.target) !== String(selectedId)) line.setAttribute('opacity', '.15');
    layer.append(line);
  });
  const rovingId = selectedId || displayNodes[0]?.id;
  displayNodes.forEach((node, index) => {
    const nodeId = String(node.id);
    const circle = svgEl('circle', { cx: node.x, cy: node.y, r: node.radius, fill: node.color, class: `node${nodeId === String(selectedId) ? ' is-focus' : ''}`, tabindex: nodeId === String(rovingId) ? '0' : '-1', role: 'button', 'aria-label': `${nodeLabel(node)}, ${fmtNum(node.messageCount || node.count)} сообщений`, 'aria-pressed': nodeId === String(selectedId) ? 'true' : 'false' });
    circle.dataset.nodeId = node.id;
    circle.style.setProperty('--node-index', index);
    const title = svgEl('title'); title.textContent = `${nodeLabel(node)} — ${fmtNum(node.messageCount || node.count)} сообщений`;
    circle.append(title);
    circle.addEventListener('mouseenter', () => focusNode(node.id, false));
    circle.addEventListener('mouseleave', clearPreview);
    circle.addEventListener('focus', () => focusNode(node.id, false));
    circle.addEventListener('blur', clearPreview);
    circle.addEventListener('click', () => commitSelection(node.id));
    circle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); commitSelection(node.id); return; }
      if (event.key === 'Escape') { selectedId = null; previewId = null; resetInspector(); if (ui.selectionStatus) ui.selectionStatus.textContent = 'выбор снят.'; applySelection(); return; }
      const direction = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!direction || displayNodes.length < 2) return;
      event.preventDefault();
      const currentIndex = displayNodes.findIndex((entry) => String(entry.id) === nodeId);
      const nextIndex = (currentIndex + direction + displayNodes.length) % displayNodes.length;
      const nextId = String(displayNodes[nextIndex].id);
      const nextNode = ui.graph.querySelector(`.node[data-node-id="${CSS.escape(nextId)}"]`);
      nextNode?.focus();
    });
    layer.append(circle);
    const label = svgEl('text', { x: node.x + node.radius + 6, y: node.y + 4, class: 'node-label', 'data-node-id': node.id }); label.textContent = nodeLabel(node).slice(0, 28); label.style.setProperty('--node-index', index); labelsGroup.append(label);
  });
  ui.graph.append(layer); ui.labels.append(labelsGroup); graphLayer = layer; labelLayer = labelsGroup;
  if (shouldAnimate && displayNodes.length) {
    animateNextRender = false;
    ui.atlasFrame.classList.add('is-ready');
    clearTimeout(introTimer);
    introTimer = setTimeout(() => ui.atlasFrame.classList.remove('is-ready'), 760);
  }
  updateAltText(model, displayNodes);
  if (selectedId && displayNodes.some((node) => String(node.id) === String(selectedId))) updateFocus(selectedId);
  applySelection();
}

function updateViewport() {
  const transform = `translate(${pan.x} ${pan.y}) scale(${zoom})`;
  graphLayer?.setAttribute('transform', transform);
  labelLayer?.setAttribute('transform', transform);
}

function updateFocus(id) {
  if (!visibleModel) return;
  const node = visibleModel.nodes.find((item) => String(item.id) === String(id));
  if (!node) return;
  const relationCount = (visibleModel.edges || []).filter((edge) => String(edge.source) === String(id) || String(edge.target) === String(id)).reduce((sum, edge) => sum + Number(edge.count || 1), 0);
  ui.focusTitle.textContent = nodeLabel(node);
  ui.focusCopy.textContent = `${node.type === 'participant' ? 'участник' : 'чат'} активен в ${fmtDate(node.firstDate)} — ${fmtDate(node.lastDate)}. цвет показывает относительную активность; размер — объём сообщений.`;
  ui.focusMetrics.innerHTML = `<div><dt>сообщения</dt><dd>${fmtNum(node.messageCount || node.count)}</dd></div><div><dt>связи</dt><dd>${fmtNum(relationCount)}</dd></div><div><dt>период</dt><dd>${esc(fmtDate(node.firstDate))} — ${esc(fmtDate(node.lastDate))}</dd></div>`;
  if (ui.relationBreakdown) {
    const relationNames = { reply: 'ответы', mention: 'упоминания', shared: 'общие чаты', time: 'близость по времени' };
    const counts = new Map();
    (visibleModel.edges || []).forEach((edge) => {
      if (String(edge.source) !== String(id) && String(edge.target) !== String(id)) return;
      const type = String(edge.type || 'relation');
      counts.set(type, (counts.get(type) || 0) + Number(edge.count || 1));
    });
    clear(ui.relationBreakdown);
    if (!counts.size) {
      ui.relationBreakdown.textContent = 'связей нет.';
    } else {
      [...counts.entries()].forEach(([type, count]) => {
        const row = document.createElement('div');
        row.className = 'relation-breakdown__row';
        const label = document.createElement('span');
        label.textContent = relationNames[type] || 'связи';
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
  updateFocus(id);
  applySelection();
}
function commitSelection(id) {
  selectedId = String(id);
  previewId = null;
  updateFocus(id);
  if (ui.selectionStatus) ui.selectionStatus.textContent = `выбрано: ${nodeLabel(visibleModel?.nodes.find((node) => String(node.id) === String(id)))}`;
  applySelection();
}
function clearPreview() {
  if (!previewId) return;
  previewId = null;
  if (selectedId && visibleModel?.nodes.some((node) => String(node.id) === String(selectedId))) updateFocus(selectedId);
  else resetInspector();
  applySelection();
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
    node.classList.toggle('is-focus', String(node.dataset.nodeId) === String(selectedId));
    node.setAttribute('aria-pressed', String(String(node.dataset.nodeId) === String(selectedId)));
    node.setAttribute('tabindex', String(node.dataset.nodeId) === String(selectedId || previewId || ui.graph.querySelector('.node')?.dataset.nodeId) ? '0' : '-1');
  });
  ui.labels.querySelectorAll('.node-label').forEach((label) => {
    const related = !activeId || String(label.dataset.nodeId) === String(activeId) || connected.has(String(label.dataset.nodeId));
    label.style.opacity = related ? '' : '.3';
  });
}
function updateAltText(model, nodes) {
  if (!model) { ui.altText.textContent = 'загрузите файл, чтобы получить текстовое описание сети.'; return; }
  if (!nodes.length) { ui.altText.textContent = 'после фильтрации узлов не осталось. измените срез или сбросьте фильтры.'; return; }
  const edges = model.edges || [];
  const top = [...nodes].sort((a, b) => Number(b.messageCount || b.count) - Number(a.messageCount || a.count)).slice(0, 6);
  const parts = [`в сети ${fmtNum(nodes.length)} узлов и ${fmtNum(edges.length)} связей.`];
  parts.push(`самые активные: ${top.map((n) => `${nodeLabel(n)} (${fmtNum(n.messageCount || n.count)})`).join(', ')}.`);
  const rels = edges.reduce((acc, edge) => { acc[edge.type || 'relation'] = (acc[edge.type || 'relation'] || 0) + 1; return acc; }, {});
  const relationNames = { reply: 'ответы', mention: 'упоминания', shared: 'общие чаты', time: 'близость по времени', relation: 'связи' };
  parts.push(`типы связей: ${Object.entries(rels).map(([key, value]) => `${relationNames[key] || 'связи'} — ${value}`).join(', ')}.`);
  ui.altText.textContent = parts.join(' ');
}

function renderTimeline(model) {
  clear(ui.timeline);
  const periods = model?.periods || [];
  if (!periods.length) { ui.timelineRange.textContent = '—'; if (ui.timelineEmpty) { ui.timelineEmpty.hidden = false; ui.timelineEmpty.textContent = model ? 'в выбранном срезе нет дат для шкалы.' : 'загрузите экспорт, чтобы увидеть периоды активности.'; } return; }
  if (ui.timelineEmpty) ui.timelineEmpty.hidden = true;
  const starts = periods.map((p) => new Date(p.start).getTime()).filter(Number.isFinite); const ends = periods.map((p) => new Date(p.end || p.start).getTime()).filter(Number.isFinite);
  const min = Math.min(...starts); const max = Math.max(...ends, min + 86400000); const span = Math.max(max - min, 86400000); ui.timelineRange.textContent = `${shortDate(new Date(min))} — ${shortDate(new Date(max))}`;
  const axisY = 80;
  ui.timeline.append(svgEl('line', { x1: 25, y1: axisY, x2: 1175, y2: axisY, class: 'timeline-axis' }));
  const peak = Math.max(...periods.map((p) => Number(p.count || p.messageCount || 1)), 1);
  periods.forEach((period, index) => {
    const start = new Date(period.start).getTime(); const end = new Date(period.end || period.start).getTime();
    const x = 25 + ((start - min) / span) * 1150; const width = Math.max(8, ((Math.max(end, start + 86400000) - start) / span) * 1150); const ratio = Number(period.count || period.messageCount || 1) / peak; const barClass = `timeline-bar${ratio > .7 ? ' is-peak' : ''}`;
    ui.timeline.append(svgEl('line', { x1: x, y1: axisY, x2: x + width, y2: axisY, class: barClass, 'stroke-width': 1.5 + ratio * 2 }));
    const periodFrom = shortDate(period.start);
    const periodTo = shortDate(period.end || period.start);
    const point = svgEl('circle', {
      cx: x + width / 2,
      cy: axisY,
      r: 2 + ratio * 2,
      class: `timeline-point${ratio > .7 ? ' is-peak' : ''}`,
      role: 'button',
      tabindex: '0',
      'aria-label': `выбрать период ${periodFrom} — ${periodTo}`,
      'data-from': periodFrom,
      'data-to': periodTo,
    });
    point.addEventListener('click', () => selectPeriod(periodFrom, periodTo));
    point.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectPeriod(periodFrom, periodTo);
    });
    ui.timeline.append(point);
    if (index % Math.max(1, Math.floor(periods.length / 7)) === 0) { ui.timeline.append(svgEl('line', { x1: x, y1: axisY, x2: x, y2: axisY + 6, class: 'timeline-tick' })); const label = svgEl('text', { x, y: axisY + 26, class: 'timeline-label', 'text-anchor': x > 1080 ? 'end' : 'start' }); label.textContent = shortDate(period.start); ui.timeline.append(label); }
  });
}
function selectPeriod(from, to) {
  if (!sourceModel) return;
  const same = ui.fromDate.value === from && ui.toDate.value === to;
  ui.fromDate.value = same ? '' : (from || '');
  ui.toDate.value = same ? '' : (to || '');
  selectedId = null;
  previewId = null;
  render();
}
function render() {
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
    setStatus(error.userMessage || error.message || 'не удалось применить фильтр.', true);
    return;
  }
  setDatasetLabel(visibleModel);
  renderSliceSummary(visibleModel);
  if (visibleModel?.filterError === 'INVALID_DATE_RANGE') setStatus('дата начала позже даты окончания. измените границы периода.', true);
  else if (ui.status.classList.contains('is-error')) setStatus('срез обновлён.');
  renderGraph(visibleModel);
  renderTimeline(visibleModel);
  if (selectedId && visibleModel?.nodes.some((n) => String(n.id) === String(selectedId))) updateFocus(selectedId);
  else { selectedId = null; resetInspector(); }
}
function resetInspector() {
  const hasVisibleNodes = Boolean(visibleModel?.nodes?.length);
  ui.focusTitle.textContent = hasVisibleNodes ? 'выберите точку на карте' : (sourceModel ? 'в этом срезе нет узлов' : 'выберите точку на карте');
  ui.focusCopy.textContent = hasVisibleNodes ? 'наведите на точку, чтобы увидеть период и счётчики. тексты сообщений скрыты.' : (sourceModel ? 'измените фильтры, чтобы вернуть точки на карту.' : 'наведите на точку, чтобы увидеть период и счётчики. тексты сообщений скрыты.');
  ui.focusMetrics.innerHTML = '<div><dt>сообщения</dt><dd>—</dd></div><div><dt>связи</dt><dd>—</dd></div><div><dt>период</dt><dd>—</dd></div>';
  if (ui.relationBreakdown) ui.relationBreakdown.textContent = 'выберите точку, чтобы увидеть типы связей.';
}

function updateScale() { ui.scale.textContent = `масштаб ${zoom.toFixed(1)}×`; ui.zoomReset.textContent = `${zoom.toFixed(1)}×`; }
function resetView() { zoom = 1; pan = { x: 0, y: 0 }; selectedId = null; updateScale(); render(); }
function applyModel(model) {
  const nextModel = model?.model || model;
  previewId = null;
  animateNextRender = true;
  if (!nextModel || !Array.isArray(nextModel.nodes) || !nextModel.nodes.length) throw new Error('в файле не найдено сообщений. нужен экспорт Telegram Desktop с массивом messages.');
  sourceModel = nextModel;
  activeFileName = pendingFileName || activeFileName;
  pendingFileName = '';
  populateControls(sourceModel); setEnabled(true); resetView(); setStatus(`готово: ${fmtNum(sourceModel.stats?.messageCount || sourceModel.nodes.reduce((sum, n) => sum + Number(n.messageCount || n.count || 0), 0))} сообщений сведено в агрегаты.`); render();
}
function parseAndRender(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('не удалось прочитать JSON. проверьте, что файл не повреждён и сохранён в формате UTF-8.'); }
  const result = parseExport(parsed, {
    onProgress: ({ phase, ratio }) => {
      if (phase === 'normalizing') {
        const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
        ui.progressLabel.textContent = 'сводим связи'; setProgress(pct);
      }
    }
  });
  applyModel(result);
}
function cancelImport({ announce = true } = {}) {
  const wasImporting = Boolean(activeReader || activeWorker || (ui.progressWrap && !ui.progressWrap.hidden));
  importToken += 1;
  if (activeReader) { try { activeReader.abort(); } catch { /* already finished */ } activeReader = null; }
  if (activeWorker) { try { activeWorker.terminate(); } catch { /* already finished */ } activeWorker = null; }
  if (ui.progressWrap) ui.progressWrap.hidden = true;
  setImporting(false);
  pendingFileName = '';
  if (announce && wasImporting) setStatus(sourceModel ? 'импорт отменён. текущая карта сохранена.' : 'импорт отменён.');
}
function readFile(file) {
  if (!file) return;
  cancelImport({ announce: false });
  if (file.size > 250 * 1024 * 1024) { finishImportError('файл больше 250 МБ. выберите меньший JSON или разбейте экспорт по чатам.'); return; }
  pendingFileName = file.name || '';
  const token = importToken;
  ui.progressWrap.hidden = false; setProgress(0); ui.progressLabel.textContent = 'читаем файл'; setImporting(true); setStatus('файл остаётся в браузере — готовим карту…');
  let worker = null;
  if (typeof Worker === 'function') {
    try { worker = new Worker('./import-worker.js', { type: 'module' }); } catch { worker = null; }
  }
  if (worker) {
    activeWorker = worker;
    worker.onmessage = (event) => {
      if (token !== importToken) { worker.terminate(); return; }
      const payload = event.data || {};
      if (payload.type === 'progress') { ui.progressLabel.textContent = payload.label || 'разбираем файл'; setProgress(payload.percent || 0); return; }
      activeWorker = null; worker.terminate();
      if (payload.type === 'error') { finishImportError(payload.message || 'формат файла не распознан.'); return; }
      try { applyModel(payload.model); setImporting(false); setProgress(100); ui.progressLabel.textContent = 'готово'; setTimeout(() => { if (token === importToken) ui.progressWrap.hidden = true; }, 900); }
      catch (error) { finishImportError(error.userMessage || error.message || 'формат файла не распознан.'); }
    };
    worker.onerror = () => { if (token !== importToken) return; finishImportError('не удалось обработать файл. попробуйте выбрать его ещё раз.'); };
    const reader = new FileReader(); activeReader = reader;
    reader.onprogress = (event) => { if (token !== importToken || !event.lengthComputable) return; const pct = Math.round(event.loaded / event.total * 100); ui.progressLabel.textContent = 'читаем файл'; setProgress(pct); };
    reader.onerror = () => { if (token !== importToken) return; finishImportError('не удалось прочитать файл. попробуйте выбрать его ещё раз.'); };
    reader.onabort = () => { if (token === importToken) { activeReader = null; ui.progressWrap.hidden = true; setImporting(false); } };
    reader.onload = () => { if (token === importToken) { activeReader = null; worker.postMessage({ buffer: reader.result }, [reader.result]); } };
    reader.readAsArrayBuffer(file);
    return;
  }
  const reader = new FileReader();
  activeReader = reader;
  reader.onprogress = (event) => { if (token !== importToken || !event.lengthComputable) return; const pct = Math.round(event.loaded / event.total * 100); setProgress(pct); };
  reader.onerror = () => { if (token !== importToken) return; finishImportError('не удалось прочитать файл. попробуйте выбрать его ещё раз.'); };
  reader.onabort = () => { if (token === importToken) { activeReader = null; ui.progressWrap.hidden = true; setImporting(false); } };
  reader.onload = () => {
    if (token !== importToken) return;
    activeReader = null;
    try { parseAndRender(String(reader.result)); setImporting(false); setProgress(100); ui.progressLabel.textContent = 'готово'; setTimeout(() => { if (token === importToken) ui.progressWrap.hidden = true; }, 900); }
    catch (error) { finishImportError(error.userMessage || error.message || 'формат файла не распознан.'); }
  };
  reader.readAsText(file);
}

function clearData() {
  cancelImport({ announce: false });
  sourceModel = null; visibleModel = null; selectedId = null; previewId = null; activeFileName = ''; pendingFileName = ''; ui.file.value = ''; ui.datasetLabel.textContent = 'файл не выбран'; setEnabled(false);
  ui.chatFilter.innerHTML = '<option value="all">все чаты</option>'; ui.personFilter.innerHTML = '<option value="all">все участники</option>'; ui.fromDate.value = ''; ui.toDate.value = ''; ui.fromDate.min = ''; ui.fromDate.max = ''; ui.toDate.min = ''; ui.toDate.max = '';
  ui.viewMode.value = 'auto'; ui.relationsOnly.checked = false;
  animateNextRender = false; clearTimeout(introTimer); ui.atlasFrame.classList.remove('is-ready'); ui.progressWrap.hidden = true; setProgress(0); setStatus('данные удалены из памяти страницы.'); zoom = 1; pan = { x: 0, y: 0 }; updateScale(); resetInspector(); renderSliceSummary(null); updateAltText(null, []); renderGraph(null); renderTimeline(null);
}
function download(name, type, body) { const blob = body instanceof Blob ? body : new Blob([body], { type }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function exportableSvg() {
  const clone = ui.atlasSvg.cloneNode(true);
  [clone, ...clone.querySelectorAll('*')].forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      if (attribute.name.startsWith('aria-') || attribute.name === 'role' || attribute.name === 'tabindex' || attribute.name.startsWith('data-')) element.removeAttribute(attribute.name);
    });
  });
  clone.removeAttribute('tabindex'); clone.removeAttribute('aria-labelledby'); clone.setAttribute('xmlns', NS);
  const style = document.createElementNS(NS, 'style');
  style.textContent = `
    .grid-line{stroke:rgba(16,33,43,.14);stroke-width:.8}.grid-axis{stroke:rgba(16,33,43,.3);stroke-width:1}
    .edge{fill:none;stroke:#39434A;stroke-opacity:.35;stroke-width:1}.edge--reply{stroke:#C45236}.edge--mention{stroke:#2F5D8A}.edge--shared{stroke:#10212B;stroke-dasharray:3 4}.edge--time{stroke:#39434A;stroke-dasharray:1 4}
    .node{stroke:#E7DFC8;stroke-width:2.3}.node.is-focus{stroke:#C45236;stroke-width:3.2}.node-label{fill:#10212B;font-family:Georgia,serif;font-size:11px}.timeline-axis{stroke:#10212B;stroke-width:1}.timeline-tick{stroke:rgba(16,33,43,.25);stroke-width:1}.timeline-bar{stroke:#2F5D8A}.timeline-bar.is-peak{stroke:#C45236}.timeline-point{fill:#2F5D8A}.timeline-point.is-peak{fill:#C45236}.timeline-label{fill:#39434A;font-family:monospace;font-size:11px}`;
  clone.insertBefore(style, clone.firstChild);
  const background = document.createElementNS(NS, 'rect'); background.setAttribute('width', '1000'); background.setAttribute('height', '610'); background.setAttribute('fill', '#E7DFC8'); clone.insertBefore(background, clone.children[1] || null);
  return clone;
}
function exportSvg() { if (!visibleModel) return; const source = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(exportableSvg())}`; download('telegram-constellation.svg', 'image/svg+xml;charset=utf-8', source); }
function exportPng() {
  if (!visibleModel) return;
  const token = importToken;
  const version = renderVersion;
  const source = new XMLSerializer().serializeToString(exportableSvg()); const image = new Image();
  image.onload = () => {
    if (token !== importToken || version !== renderVersion || !visibleModel) return;
    const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = 1220; const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#E7DFC8'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => { if (blob && token === importToken && version === renderVersion && visibleModel) download('telegram-constellation.png', 'image/png', blob); });
  };
  image.onerror = () => { if (token === importToken && version === renderVersion) setStatus('не удалось подготовить PNG. скачайте карту в SVG.', true); };
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
  zoom = next; updateScale();
  if (visibleModel) { updateViewport(); renderVersion += 1; } else render();
}
function svgPoint(clientX, clientY) {
  try {
    const point = ui.atlasSvg.createSVGPoint(); point.x = clientX; point.y = clientY;
    const matrix = ui.atlasSvg.getScreenCTM()?.inverse(); if (matrix) { const transformed = point.matrixTransform(matrix); return { x: transformed.x, y: transformed.y }; }
  } catch { /* fallback below */ }
  const rect = ui.atlasSvg.getBoundingClientRect();
  return { x: rect.width ? (clientX - rect.left) / rect.width * 1000 : 500, y: rect.height ? (clientY - rect.top) / rect.height * 610 : 305 };
}

function wire() {
  ui.file.addEventListener('change', (event) => readFile(event.target.files[0]));
  ['dragenter', 'dragover'].forEach((name) => ui.dropzone.addEventListener(name, (event) => { event.preventDefault(); ui.dropzone.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach((name) => ui.dropzone.addEventListener(name, (event) => { event.preventDefault(); ui.dropzone.classList.remove('is-dragging'); }));
  ui.dropzone.addEventListener('drop', (event) => readFile(event.dataTransfer.files[0]));
  ui.dropzone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); ui.file.click(); } });
  ui.cancelImport?.addEventListener('click', () => cancelImport());
  [ui.viewMode, ui.relationsOnly, ui.chatFilter, ui.personFilter, ui.fromDate, ui.toDate].forEach((el) => el.addEventListener('change', () => { selectedId = null; render(); }));
  ui.resetView.addEventListener('click', resetView); ui.resetFilters?.addEventListener('click', resetFilters); ui.clearData.addEventListener('click', clearData); ui.exportSvg.addEventListener('click', exportSvg); ui.exportPng.addEventListener('click', exportPng);
  ui.zoomOut.addEventListener('click', () => zoomAt(zoom * .85)); ui.zoomIn.addEventListener('click', () => zoomAt(zoom * 1.18)); ui.zoomReset.addEventListener('click', resetView);
  ui.atlasSvg.addEventListener('wheel', (event) => { if (!sourceModel) return; event.preventDefault(); zoomAt(zoom * (event.deltaY > 0 ? .9 : 1.1), event); }, { passive: false });
  ui.atlasSvg.addEventListener('pointerdown', (event) => { if (event.target.closest('.node')) return; drag = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; ui.atlasSvg.setPointerCapture(event.pointerId); });
  ui.atlasSvg.addEventListener('pointermove', (event) => { if (!drag) return; const rect = ui.atlasSvg.getBoundingClientRect(); const sx = rect.width ? 1000 / rect.width : 1; const sy = rect.height ? 610 / rect.height : 1; pan.x = drag.panX + (event.clientX - drag.x) * sx; pan.y = drag.panY + (event.clientY - drag.y) * sy; updateViewport(); renderVersion += 1; });
  ['pointerup', 'pointercancel'].forEach((name) => ui.atlasSvg.addEventListener(name, () => { drag = null; }));
  ui.atlasSvg.addEventListener('keydown', (event) => { if (event.key === 'Escape') { selectedId = null; previewId = null; resetInspector(); if (ui.selectionStatus) ui.selectionStatus.textContent = 'выбор снят.'; applySelection(); } });
}

buildGrid(); wire(); setEnabled(false); setImporting(false);
