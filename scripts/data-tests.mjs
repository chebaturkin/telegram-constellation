import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseExport, filterModel, deriveRelations, ExportFormatError } from '../app-data.js';

test('relation types filter both layers and their counts without changing messages or the source', () => {
  const model = parseExport(archive(
    chat(1, [message(1, 1, '2026-02-01T12:00:00'), message(2, 2, '2026-02-01T12:01:00', { reply_to_message_id: 1 })]),
    chat(2, [message(3, 1, '2026-02-01T12:02:00'), message(4, 3, '2026-02-01T12:03:00')]),
  ));
  const before = JSON.stringify(model);
  const view = filterModel(model, { mode: 'participants', relationTypes: ['reply'] });
  assert.deepEqual(view.edges.map((edge) => edge.type), ['reply']);
  assert.equal(view.chatEdges.length, 0);
  assert.deepEqual(view.participantEdges, view.edges);
  assert.equal(view.stats.relationCount, 1);
  assert.deepEqual(view.stats.relationCounts, { reply: 1, mention: 0, shared: 0, time: 0 });
  assert.equal(view.stats.messageCount, 4);
  assert.equal(view.nodes.length, 3);
  assert.equal(view.periods[0].count, 4);
  assert.equal(JSON.stringify(model), before);
  assert.equal(filterModel(model, { mode: 'chats', relationTypes: ['reply'] }).edges.length, 0);
});

test('an empty type selection hides edges while keeping the full message slice', () => {
  const model = parseExport([message(1, 1, '2026-02-01T12:00:00'), message(2, 2, '2026-02-01T12:01:00')]);
  const view = filterModel(model, { relationTypes: [] });
  assert.equal(view.edges.length, 0);
  assert.equal(view.participantEdges.length, 0);
  assert.equal(view.stats.relationCount, 0);
  assert.equal(view.nodes.length, 2);
  assert.equal(view.stats.messageCount, 2);
  assert.deepEqual(filterModel(model).edges, model.edges);
});

test('relation type selection composes with calendar and chat filters', () => {
  const model = parseExport(archive(chat(1, [
    message(1, 1, '2026-02-01T12:00:00'),
    message(2, 2, '2026-02-01T12:01:00', { reply_to_message_id: 1 }),
    message(3, 1, '2026-03-01T12:00:00'),
    message(4, 2, '2026-03-01T12:01:00'),
  ]), chat(2, [message(1, 3, '2026-03-01T12:00:00')])));
  const view = filterModel(model, { chatId: '1', from: '2026-03-01', to: '2026-03-01', mode: 'participants', relationTypes: ['reply'] });
  assert.equal(view.edges.length, 0);
  assert.equal(view.stats.messageCount, 2);
  assert.deepEqual(view.nodes.map((node) => node.id), ['user1', 'user2']);
});

const message = (id, sender, date, extra = {}) => ({ id, type: 'message', from: `Участник ${sender}`, from_id: `user${sender}`, date, text: 'PRIVATE_MESSAGE_BODY', ...extra });
const chat = (id, messages) => ({ id, name: `Чат ${id}`, messages });
const archive = (...chats) => ({ chats: { list: chats } });
const relation = (edges, type, a, b) => edges.find((edge) => edge.type === type && new Set([edge.source, edge.target]).has(a) && new Set([edge.source, edge.target]).has(b));

test('chat filter removes other chats and rebuilds both node layers', () => {
  const model = parseExport(archive(chat(1, [message(1, 1, '2026-02-01T12:00:00')]), chat(2, [message(1, 2, '2026-03-01T12:00:00')])));
  const view = filterModel(model, { chatId: '1', mode: 'chats' });
  assert.deepEqual(view.nodes.map((node) => node.id), ['1']);
  assert.deepEqual(view.participantNodes.map((node) => node.id), ['user1']);
  assert.equal(view.stats.chatCount, 1);
  assert.equal(view.stats.participantCount, 1);
  assert.deepEqual(view.periods.map((period) => period.key), ['2026-02']);
});

test('participant filter recalculates message counts and calendar periods', () => {
  const model = parseExport(archive(chat(1, [message(1, 1, '2026-02-01T12:00:00'), message(2, 2, '2026-02-01T12:02:00'), message(3, 2, '2026-03-01T12:00:00')]), chat(2, [message(4, 2, '2026-04-01T12:00:00')])));
  const view = filterModel(model, { participantId: 'user1', mode: 'chats' });
  assert.equal(view.nodes[0].messageCount, 1);
  assert.equal(view.nodes[0].activity, 1);
  assert.equal(view.nodes[0].lastDate, '2026-02-01T12:00:00.000Z');
  assert.deepEqual(view.nodes[0].participantIds, ['user1']);
  assert.equal(view.periods[0].count, 1);
  assert.equal(view.periods.length, 1);
  assert.equal(view.stats.messageCount, 1);
  assert.equal(view.stats.chatCount, 1);
  assert.equal(view.stats.participantCount, 1);
});

test('date filter rebuilds relation counts from surviving messages', () => {
  const model = parseExport(archive(chat(1, [message(1, 1, '2026-02-01T12:00:00'), message(2, 2, '2026-02-01T12:01:00', { reply_to_message_id: 1 }), message(3, 1, '2026-03-01T12:00:00'), message(4, 2, '2026-03-01T12:01:00')])));
  const view = filterModel(model, { from: '2026-03-01', to: '2026-03-01', mode: 'participants' });
  assert.equal(relation(view.edges, 'time', 'user1', 'user2').count, 1);
  assert.equal(view.edges.some((edge) => edge.type === 'reply'), false);
  assert.deepEqual(view.nodes.map((node) => node.messageCount), [1, 1]);
  assert.equal(view.periods[0].count, 2);
  assert.deepEqual(deriveRelations(view), { participantEdges: view.participantEdges, chatEdges: view.chatEdges });
});

test('date bounds include the whole exported calendar day, including fractional seconds', () => {
  const model = parseExport([message(1, 1, '2026-02-02T00:00:00+03:00'), message(2, 1, '2026-02-02T23:59:59.999+03:00'), message(3, 1, '2026-02-03T00:00:00+03:00')]);
  const view = filterModel(model, { from: '2026-02-02', to: '2026-02-02' });
  assert.deepEqual(view.messages.map((record) => record.messageId), ['1', '2']);
});

test('timezone-less export timestamps stay deterministic across environments', () => {
  const model = parseExport([message(1, 1, '2026-02-02T23:59:59.999')]);
  assert.equal(model.messages[0].date, '2026-02-02T23:59:59.999Z');
  assert.equal(filterModel(model, { to: '2026-02-02' }).stats.messageCount, 1);
});

test('missing dates are retained without date filters and excluded with either date bound', () => {
  const model = parseExport([message(1, 1, null), message(2, 2, '2026-02-02T12:00:00')]);
  assert.equal(filterModel(model).stats.messageCount, 2);
  assert.equal(filterModel(model, { to: '2026-02-02' }).stats.messageCount, 1);
  assert.equal(filterModel(model, { from: '2026-02-02' }).stats.messageCount, 1);
});

test('Telegram text_entities and structured text mention IDs resolve user aliases', () => {
  const model = parseExport([
    message(1, 42, '2026-02-02T12:00:00'),
    message(2, 1, '2026-02-02T13:00:00', { text: 'SECRET_VISIBLE_LABEL', text_entities: [{ type: 'mention_name', text: 'SECRET_VISIBLE_LABEL', user_id: 42 }] }),
    message(3, 2, '2026-02-02T14:00:00', { text: [{ type: 'text_mention', text: 'SECRET_VISIBLE_LABEL', user: { id: 'user42' } }] }),
    message(4, 3, '2026-02-02T15:00:00', { text: [{ type: 'mention_name', text: 'SECRET_VISIBLE_LABEL', user_id: '42' }] }),
  ]);
  assert.equal(relation(model.participantEdges, 'mention', 'user1', 'user42').count, 1);
  assert.equal(relation(model.participantEdges, 'mention', 'user2', 'user42').count, 1);
  assert.equal(relation(model.participantEdges, 'mention', 'user3', 'user42').count, 1);
  assert.equal(JSON.stringify(model).includes('SECRET_VISIBLE_LABEL'), false);
});

test('mention entities match exported usernames and count each target once per message', () => {
  const model = parseExport([
    message(1, 42, '2026-02-02T12:00:00', { username: 'forty_two' }),
    message(2, 1, '2026-02-02T13:00:00', { text: [{ type: 'mention', text: '@forty_two' }], text_entities: [{ type: 'mention', text: '@forty_two' }, { type: 'mention_name', text: 'PRIVATE_MESSAGE_BODY', user_id: 42 }] }),
  ]);
  assert.equal(relation(model.participantEdges, 'mention', 'user1', 'user42').count, 1);
});

test('replies never infer a different chat from a locally missing message ID', () => {
  const model = parseExport(archive(chat(1, [message(17, 1, '2026-02-01T12:00:00')]), chat(2, [message(18, 2, '2026-02-01T14:00:00', { reply_to_message_id: 17 })])));
  assert.equal(model.participantEdges.some((edge) => edge.type === 'reply'), false);
});

test('explicit cross-chat replies use the referenced chat ID', () => {
  const model = parseExport(archive(chat(1, [message(17, 1, '2026-02-01T12:00:00')]), chat(2, [message(17, 3, '2026-02-01T14:00:00'), message(18, 2, '2026-02-01T15:00:00', { reply_to: { chat_id: 1, message_id: 17 } })])));
  assert.equal(relation(model.participantEdges, 'reply', 'user1', 'user2').count, 1);
  assert.equal(relation(model.chatEdges, 'reply', '1', '2').count, 1);
});

test('service events do not inflate participants, activity or message counts', () => {
  const model = parseExport(archive(chat(1, [message(1, 1, '2026-02-02T12:00:00'), { id: 2, type: 'service', actor: 'Service author', actor_id: 'user2', date: '2026-02-03T12:00:00', action: 'join_group' }]), chat(2, [{ id: 3, type: 'service', action: 'create_group' }])));
  assert.equal(model.stats.messageCount, 1);
  assert.equal(model.stats.participantCount, 1);
  assert.equal(model.stats.chatCount, 1);
  assert.equal(model.messages.length, 1);
  assert.equal(model.periods[0].count, 1);
});

test('temporal edges count every message pair in the window without an arbitrary neighbor cap', () => {
  const records = Array.from({ length: 20 }, (_, i) => message(i + 1, 1, '2026-02-02T12:00:00'));
  records.push(message(21, 2, '2026-02-02T12:01:00'));
  const model = parseExport(records);
  assert.equal(relation(model.participantEdges, 'time', 'user1', 'user2').count, 20);
  assert.equal(deriveRelations(model, { timeWindowMs: 30_000 }).participantEdges.some((edge) => edge.type === 'time'), false);
});

test('filtering every record produces a consistent empty model without stale periods or edges', () => {
  const model = parseExport([message(1, 1, '2026-02-02T12:00:00')]);
  const view = filterModel(model, { from: '2027-01-01' });
  assert.deepEqual(view.nodes, []);
  assert.deepEqual(view.chatNodes, []);
  assert.deepEqual(view.participantNodes, []);
  assert.deepEqual(view.edges, []);
  assert.deepEqual(view.periods, []);
  assert.deepEqual(view.stats, {
    messageCount: 0,
    chatCount: 0,
    participantCount: 0,
    relationCount: 0,
    relationCounts: { reply: 0, mention: 0, shared: 0, time: 0 },
    undatedCount: 0,
    skippedCount: 0,
  });
});

test('parse and filter keep input unchanged and never retain full message text', () => {
  const input = archive(chat(1, [message(1, 1, '2026-02-02T12:00:00', { text: 'UNIQUE_PRIVATE_BODY' }), message(2, 2, '2026-02-02T12:01:00', { reply_to_message_id: 1 })]));
  const before = JSON.stringify(input);
  const model = parseExport(input);
  filterModel(model, { participantId: 'user1' });
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(model).includes('UNIQUE_PRIVATE_BODY'), false);
  assert.equal(model.messages.some((record) => Object.hasOwn(record, 'source') || Object.hasOwn(record, 'text')), false);
  assert.equal(/\"source\"\s*:/.test(JSON.stringify(model.messages)), false);
  assert.equal(model.chatNodes[0].label, 'Чат 1');
  assert.equal(model.participantNodes[0].label, 'Участник 1');
});

test('format errors and progress stay suitable for the interface', () => {
  assert.throws(() => parseExport('{private malformed'), (error) => error instanceof ExportFormatError && error.code === 'INVALID_JSON' && !error.message.includes('private malformed'));
  assert.throws(() => parseExport({ unrelated: [] }), (error) => error.code === 'UNSUPPORTED_FORMAT');
  assert.throws(() => parseExport([]), (error) => error.code === 'NO_MESSAGES');
  const progress = [];
  parseExport([message(1, 1, '2026-02-02T12:00:00')], { onProgress: (value) => progress.push(value) });
  assert.equal(progress.at(-1).phase, 'complete');
  assert.equal(progress.at(-1).ratio, 1);
});

test('dirty chat and message entries are skipped without raw TypeErrors', () => {
  const model = parseExport({ chats: { list: [null, { id: 7, name: 'Грязный чат', messages: [null, 'not-a-message', message(1, 7, '2026-02-02T12:00:00')] }] } });
  assert.equal(model.stats.messageCount, 1);
  assert.deepEqual(model.chatNodes.map((node) => node.id), ['7']);
  assert.deepEqual(model.participantNodes.map((node) => node.id), ['user7']);
  assert.throws(() => parseExport({ chats: { list: [null, { id: 8, messages: [null, 'still-not-a-message'] }] } }), (error) => error instanceof ExportFormatError && error.code === 'NO_MESSAGES');
});

test('sender, date, and reply fallback fields survive blank primary values', () => {
  const model = parseExport([
    { id: 1, actor: 'Алиса', actor_id: 'user-1', date: '', date_unixtime: '1760000000', text: '' },
    { id: 2, from: 'Боб', from_id: 'user-2', date: '2026-02-02T12:01:00', reply_to_message_id: '', reply_to: { message_id: 1 }, text: '' },
  ]);
  assert.equal(model.messages[0].senderId, 'user-1');
  assert.equal(model.messages[0].senderName, 'Алиса');
  assert.equal(model.messages[0].date, new Date(1760000000 * 1000).toISOString());
  assert.equal(relation(model.participantEdges, 'reply', 'user-1', 'user-2').count, 1);
});

test('invalid calendar dates are rejected instead of normalized into another day', () => {
  const model = parseExport([message(1, 1, '2026-02-31')]);
  assert.equal(model.messages[0].date, null);
  assert.equal(model.messages[0].dateKey, null);
  assert.deepEqual(model.periods, []);
});

test('participant labels upgrade when an early message lacks a sender name', () => {
  const model = parseExport([
    { id: 1, from_id: 'user-1', date: '2026-02-01T12:00:00', text: '' },
    { id: 2, from: 'Алиса', from_id: 'user-1', date: '2026-02-02T12:00:00', text: '' },
  ]);
  assert.equal(model.participantNodes[0].label, 'Алиса');
});

test('reversed date bounds return an explicit empty slice', () => {
  const model = parseExport([message(1, 1, '2026-02-02T12:00:00')]);
  const view = filterModel(model, { from: '2026-03-01', to: '2026-02-01' });
  assert.equal(view.filterError, 'INVALID_DATE_RANGE');
  assert.deepEqual(view.nodes, []);
  assert.equal(view.stats.messageCount, 0);
});

test('model stats expose safe diagnostics without message text', () => {
  const model = parseExport({
    chats: { list: [{
      id: 1,
      name: 'Чат',
      messages: [
        message(1, 1, '2026-02-01T12:00:00'),
        { id: 2, type: 'service', actor_id: 'user2', date: '2026-02-02T12:00:00' },
        null,
        message(3, 2, null, { reply_to_message_id: 1 }),
      ],
    }] },
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
    chat(2, [message(3, 3, null)]),
  ));
  const view = filterModel(model, { chatId: '1', mode: 'participants' });
  assert.equal(view.stats.messageCount, 2);
  assert.equal(view.stats.undatedCount, 0);
  assert.equal(view.stats.chatCount, 1);
  assert.equal(view.stats.participantCount, 2);
});
