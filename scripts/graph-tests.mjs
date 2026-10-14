import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNeighbors, relationNamesFor } from '../app-graph.js';
import { parseExport, filterModel } from '../app-data.js';

test('shared labels describe the active layer, including empty chat slices', () => {
  const model = parseExport({ chats: { list: [
    { id: 'one', name: 'чат один', messages: [{ id: 1, from_id: 'a', from: 'Анна', date: '2026-04-02' }] },
    { id: 'two', name: 'чат два', messages: [{ id: 1, from_id: 'a', from: 'Анна', date: '2026-04-02' }] },
  ] } });
  assert.equal(getNeighbors(model, 'one')[0].counts.shared, 1);
  assert.equal(relationNamesFor(model).shared, 'общие участники');
  assert.equal(relationNamesFor(filterModel(model, { mode: 'participants' })).shared, 'общие чаты');
  assert.equal(relationNamesFor(filterModel(model, { mode: 'chats', from: '2027-01-01' })).shared, 'общие участники');
});

test('neighbors combine parallel undirected edges once per node and keep type counts separate', () => {
  const model = {
    nodes: [{ id: 'a', label: 'Анна' }, { id: 'b', label: 'Борис' }, { id: 'c', label: 'Вера' }],
    edges: [
      { source: 'a', target: 'c', type: 'time', count: 7 },
      { source: 'a', target: 'b', type: 'reply', count: 2 },
      { source: 'b', target: 'a', type: 'reply', count: 3 },
      { source: 'b', target: 'a', type: 'shared', count: 1 },
      { source: 'b', target: 'c', type: 'reply', count: 99 },
    ],
  };
  const before = JSON.stringify(model);
  assert.deepEqual(getNeighbors(model, 'a'), [
    { node: model.nodes[1], counts: { reply: 5, shared: 1 } },
    { node: model.nodes[2], counts: { time: 7 } },
  ]);
  assert.equal(JSON.stringify(model), before);
});

test('neighbors come only from the visible slice, ignore missing endpoints and self edges', () => {
  const model = { nodes: [{ id: 1, label: 'Анна' }, { id: 2, label: 'Борис' }], edges: [
    { source: '1', target: '2', type: 'mention', count: 1 },
    { source: '1', target: 'absent', type: 'reply', count: 7 },
    { source: '1', target: '1', type: 'shared', count: 7 },
  ] };
  assert.equal(getNeighbors(model, '1').length, 1);
  assert.deepEqual(getNeighbors({ ...model, edges: [] }, '1'), []);
  assert.deepEqual(getNeighbors(model, 'absent'), []);
  assert.deepEqual(getNeighbors(null, '1'), []);
});
