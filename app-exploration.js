import { t, getLocale, localeTag, mountLocale, translateMessage, setLocale } from './i18n.js';
import { getNeighbors, relationNames, relationNamesFor } from './app-graph.js';

export { relationNames, relationNamesFor };
let renderedModel;
let renderedId;
let renderedSelect;
const fmtNum = (value) => new Intl.NumberFormat(localeTag()).format(value);
const pluralRu = (value, forms) => {
  if (getLocale() === 'en') return Number(value) === 1 ? forms[0] : forms[2];
  const n = Math.abs(value);
  return forms[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2];
};

export function renderNeighbors(model, id, onSelect) {
  // Hovering a pinned selection must preserve its disclosure, focus and scroll.
  if (model === renderedModel && id === renderedId && onSelect === renderedSelect) return;
  renderedModel = model;
  renderedId = id;
  renderedSelect = onSelect;
  const section = document.getElementById('related-nodes');
  const expanded = section.querySelector('details')?.open || false;
  section.replaceChildren();
  section.hidden = id === null || id === undefined || !model;
  if (section.hidden) return;
  const neighbors = getNeighbors(model, id);
  const heading = document.createElement(neighbors.length ? 'summary' : 'h3');
  heading.id = 'related-heading';
  heading.textContent = t("s99", { p0: fmtNum(neighbors.length) });
  if (!neighbors.length) {
    const empty = document.createElement('p');
    empty.textContent = t("s100");
    section.append(heading, empty);
    return;
  }
  const details = document.createElement('details');
  details.open = expanded;
  details.append(heading);
  const list = document.createElement('ul');
  neighbors.forEach(({ node, counts }) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.nodeId = node.id;
    const name = document.createElement('span');
    name.className = 'related-name';
    name.textContent = node.label || t("s0");
    const summary = document.createElement('span');
    summary.className = 'related-summary';
    summary.textContent = Object.entries(relationNamesFor(model)).filter(([type]) => counts[type]).map(([type, label]) => `${label}: ${fmtNum(counts[type])}`).join(' · ');
    const arrow = document.createElement('span');
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');
    button.setAttribute('aria-label', t("s101", { p0: name.textContent, p1: summary.textContent }));
    button.append(name, summary, arrow);
    button.addEventListener('click', () => onSelect(node.id));
    item.append(button); list.append(item);
  });
  details.append(list);
  section.append(details);
}

export function renderImportNotes(model) {
  const notes = document.getElementById('import-notes');
  const undated = model?.stats?.undatedCount || 0;
  const skipped = model?.stats?.skippedCount || 0;
  const parts = [];
  if (undated) parts.push(t("s102", { p0: fmtNum(undated), p1: pluralRu(undated, [t("s6"), t("s7"), t("s8")]) }));
  if (skipped) parts.push(t("s103", { p0: pluralRu(skipped, [t("s104"), t("s105"), t("s106")]), p1: fmtNum(skipped), p2: pluralRu(skipped, [t("s107"), t("s108"), t("s109")]) }));
  const text = parts.join(' ');
  if (notes.textContent !== text) notes.textContent = text;
  notes.hidden = !parts.length;
}
