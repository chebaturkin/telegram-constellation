import { t, getLocale, localeTag, mountLocale, translateMessage, setLocale } from './i18n.js';
// Read only the current graph: no raw messages or extra relationship inference.
export const relationNames = { get reply() { return t("s95"); }, get mention() { return t("s96"); }, get shared() { return t("s76"); }, get time() { return t("s97"); } };

export function relationNamesFor(model) {
  const chatLayer = Boolean(model && model.nodes === model.chatNodes);
  return chatLayer ? { ...relationNames, get shared() { return t("s98"); } } : relationNames;
}

export function getNeighbors(model, id) {
  const nodeId = String(id);
  const nodes = new Map((model?.nodes || []).map((node) => [String(node.id), node]));
  if (!nodes.has(nodeId)) return [];
  const neighbors = new Map();
  (model.edges || []).forEach((edge) => {
    const source = String(edge.source); const target = String(edge.target);
    const otherId = source === nodeId ? target : target === nodeId ? source : null;
    if (otherId === null || otherId === nodeId || !nodes.has(otherId)) return;
    const neighbor = neighbors.get(otherId) || { node: nodes.get(otherId), counts: {} };
    neighbor.counts[edge.type] = (neighbor.counts[edge.type] || 0) + Number(edge.count || 1);
    neighbors.set(otherId, neighbor);
  });
  return [...neighbors.values()].sort((a, b) => (a.node.label || '').localeCompare(b.node.label || '', getLocale()));
}
