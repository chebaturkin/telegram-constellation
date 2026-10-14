/**
 * Aggregate-only Telegram export parser. Message bodies are inspected transiently
 * while deriving relationships and are never stored in the returned model.
 */
const asArray = (value) => Array.isArray(value) ? value : [];
const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hasValue = (value) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '') && !(typeof value === 'number' && Number.isNaN(value));
const firstValue = (...values) => values.find(hasValue);

/** A parser failure with copy suitable for the import error state. */
export class ExportFormatError extends Error {
  constructor(message, code = 'UNSUPPORTED_FORMAT') {
    super(message);
    this.name = 'ExportFormatError';
    this.code = code;
    this.userMessage = message;
  }
}

const parseInput = (input) => {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    throw new ExportFormatError('не удалось прочитать json. выберите исходный result.json из telegram desktop.', 'INVALID_JSON');
  }
};

const textValue = (value) => {
  if (Array.isArray(value)) return value.map((part) => typeof part === 'string' ? part : textValue(part?.text || '')).join('');
  if (value && typeof value === 'object') return typeof value.text === 'string' ? value.text : '';
  return typeof value === 'string' ? value : '';
};
const safeDate = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      const milliseconds = numeric < 1e12 ? numeric * 1000 : numeric;
      const numericDate = new Date(milliseconds);
      return Number.isNaN(numericDate.getTime()) ? null : numericDate.toISOString();
    }
  }
  const raw = String(value).trim();
  const datePrefix = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (datePrefix) {
    const year = Number(datePrefix[1]); const month = Number(datePrefix[2]); const day = Number(datePrefix[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (month < 1 || month > 12 || day < 1 || probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  }
  // Telegram exports sometimes omit a timezone. Interpret these timestamps as
  // UTC so the normalized result does not change with the browser's locale.
  const timezoneLess = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(raw);
  const date = new Date(timezoneLess ? `${raw.replace(' ', 'T')}Z` : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const exportDateOf = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return safeDate(value) ? direct[1] : null;
  const normalized = safeDate(value);
  return normalized ? normalized.slice(0, 10) : null;
};
const normalizedDateFields = (message) => {
  const candidates = [message?.date, message?.date_unixtime, message?.timestamp];
  for (const candidate of candidates) {
    const date = safeDate(candidate);
    if (date) return { date, dateKey: exportDateOf(candidate) };
  }
  return { date: null, dateKey: null };
};
const idOf = (value, fallback) => value === undefined || value === null || value === '' ? fallback : String(value);
const labelOf = (value, fallback) => String(value || fallback || 'без имени').replace(/\s+/g, ' ').trim().slice(0, 80) || 'без имени';
const normalizedId = (value) => String(value ?? '').replace(/^user[-_]?/i, '');
const entityList = (message) => [
  ...asArray(message?.entities),
  ...asArray(message?.text_entities),
  ...asArray(message?.text).filter((part) => part && typeof part === 'object' && part.type),
  ...(message?.text && !Array.isArray(message.text) && typeof message.text === 'object' && message.text.type ? [message.text] : []),
];
const mentionTargets = (message) => {
  const raw = textValue(message?.text);
  const entities = entityList(message);
  const mentions = [];
  const ids = [];
  entities.forEach((entity) => {
    const type = String(entity?.type || '').toLowerCase();
    if (type === 'text_mention' || type === 'mention_name') {
      const targetId = entity.user_id ?? entity.user?.id ?? entity.user?.user_id;
      if (targetId !== undefined && targetId !== null && targetId !== '') ids.push(String(targetId));
      const inline = textValue(entity.text).replace(/^@/, '').trim();
      if (inline && !targetId) mentions.push(inline.toLowerCase());
    }
    if (type === 'mention' && Number.isFinite(Number(entity.offset))) {
      const offset = Number(entity.offset); const length = Number(entity.length || 0); const value = raw.slice(offset, offset + length).replace(/^@/, ''); if (value) mentions.push(value.toLowerCase());
    }
    if (type === 'mention' && !Number.isFinite(Number(entity.offset))) {
      const value = textValue(entity.text).replace(/^@/, '').trim(); if (value) mentions.push(value.toLowerCase());
    }
  });
  if (!mentions.length) (raw.match(/@[\p{L}\d_]{2,}/gu) || []).forEach((mention) => mentions.push(mention.slice(1).toLowerCase()));
  return { names: mentions, ids };
};
const incrementEdgeBy = (map, a, b, type, amount = 1) => {
  if (!a || !b || a === b) return;
  const source = String(a); const target = String(b); const key = source < target ? `${source}|${target}|${type}` : `${target}|${source}|${type}`;
  const count = Number(amount); if (!Number.isFinite(count) || count <= 0) return;
  const existing = map.get(key); if (existing) existing.count += count; else map.set(key, { source, target, type, count });
};
const incrementEdge = (map, a, b, type) => incrementEdgeBy(map, a, b, type, 1);
const lowerBound = (values, target) => {
  let low = 0; let high = values.length;
  while (low < high) { const middle = (low + high) >> 1; if (values[middle] < target) low = middle + 1; else high = middle; }
  return low;
};

function extractChats(input) {
  const parsed = parseInput(input);
  const root = parsed?.result && typeof parsed.result === 'object' ? parsed.result : parsed;
  if (Array.isArray(root)) return [{ id: 'chat-1', name: 'экспорт сообщений', type: 'personal', messages: root }];
  const list = asArray(root?.chats?.list).filter(isRecord);
  if (list.length) return list.map((chat, index) => ({ ...chat, id: idOf(chat.id, `chat-${index + 1}`), name: labelOf(chat.name || chat.title, `чат ${index + 1}`), messages: asArray(chat.messages) }));
  if (Array.isArray(root?.messages)) return [{ ...root, id: idOf(root.id, 'chat-1'), name: labelOf(root.name || root.title, 'экспорт сообщений'), messages: root.messages }];
  if (isRecord(root?.chat) && Array.isArray(root.chat.messages)) return [{ ...root.chat, id: idOf(root.chat.id, 'chat-1'), name: labelOf(root.chat.name || root.chat.title, 'экспорт сообщений'), messages: root.chat.messages }];
  return [];
}

function buildNodes(chats, messageRecords) {
  const chatMap = new Map(chats.map((chat) => [String(chat.id), { id: String(chat.id), label: labelOf(chat.name, chat.id), type: 'chat' }]));
  const people = new Map();
  messageRecords.forEach((record) => {
    const personId = String(record.senderId || 'unknown-sender');
    const person = people.get(personId) || { id: personId, label: labelOf(record.senderName, personId), username: record.senderUsername || null, type: 'participant', chatIds: new Set(), messageCount: 0, dates: [] };
    const candidateLabel = labelOf(record.senderName, personId);
    if ((person.label === personId || person.label === 'без имени') && candidateLabel !== personId) person.label = candidateLabel;
    if (!person.username && record.senderUsername) person.username = record.senderUsername;
    person.chatIds.add(record.chatId); person.messageCount += 1; if (record.date) person.dates.push(record.date); people.set(personId, person);
  });
  const toNode = (base, records) => {
    const dates = records.map((record) => record.date).filter(Boolean).sort(); const messageCount = records.length;
    const dateKey = records.map((record) => record.dateKey).filter(Boolean).sort()[0];
    const periodIndex = dateKey ? Math.max(0, Math.floor((Number(dateKey.slice(5, 7)) - 1) / 2)) : 0;
    return { id: String(base.id), label: base.label, type: base.type, messageCount, activity: messageCount, firstDate: dates[0] || null, lastDate: dates.at(-1) || null, periodIndex, chatIds: [...new Set(records.map((record) => record.chatId).filter(Boolean))], participantIds: [...new Set(records.map((record) => record.senderId).filter(Boolean))] };
  };
  const recordsByChat = new Map();
  messageRecords.forEach((record) => { const list = recordsByChat.get(String(record.chatId)) || []; list.push(record); recordsByChat.set(String(record.chatId), list); });
  const chatNodes = [...recordsByChat.keys()].map((id) => chatMap.get(id) || { id, label: labelOf(id, id), type: 'chat' }).map((chat) => toNode(chat, recordsByChat.get(String(chat.id)) || []));
  const recordsByPerson = new Map();
  messageRecords.forEach((record) => { const list = recordsByPerson.get(String(record.senderId)) || []; list.push(record); recordsByPerson.set(String(record.senderId), list); });
  const participantNodes = [...people.values()].map((person) => ({ ...toNode({ id: person.id, label: person.label, type: person.type }, recordsByPerson.get(person.id) || []), username: person.username || null }));
  return { chatNodes, participantNodes, chats: chatNodes.map(({ id, label }) => ({ id, label })), participants: participantNodes.map(({ id, label, username }) => ({ id, label, username })) };
}

function buildEdges(records, nodeSets, options = {}) {
  const timeWindowMs = Number.isFinite(options.timeWindowMs) ? Math.max(0, options.timeWindowMs) : 10 * 60 * 1000;
  const edgeMap = new Map(); const chatEdgeMap = new Map(); const replyIndex = new Map();
  const participantById = new Map();
  const participantByAlias = new Map();
  asArray(nodeSets?.participantNodes).forEach((node) => {
    const id = String(node.id);
    participantById.set(normalizedId(id), id);
    [node.username, node.label].filter(Boolean).forEach((alias) => participantByAlias.set(String(alias).toLowerCase().replace(/^@/, ''), id));
  });
  records.forEach((record) => {
    if (!record.messageId) return;
    replyIndex.set(`${record.chatId}:${record.messageId}`, record);
  });
  records.forEach((record) => {
    const currentParticipant = record.senderId;
    const targetRecord = record.replyId
      ? replyIndex.get(`${record.replyChatId || record.chatId}:${record.replyId}`)
      : null;
    if (targetRecord) {
      incrementEdge(edgeMap, currentParticipant, targetRecord.senderId, 'reply');
      incrementEdge(chatEdgeMap, record.chatId, targetRecord.chatId, 'reply');
    }
    const mentions = { names: asArray(record.mentionNames), ids: asArray(record.mentionIds) };
    const mentionedParticipants = new Set();
    mentions.ids.forEach((targetId) => {
      const target = participantById.get(normalizedId(targetId));
      if (target && !mentionedParticipants.has(String(target))) { mentionedParticipants.add(String(target)); incrementEdge(edgeMap, currentParticipant, target, 'mention'); }
    });
    mentions.names.forEach((mention) => {
      const target = participantByAlias.get(String(mention).toLowerCase().replace(/^@/, ''));
      if (target && !mentionedParticipants.has(String(target))) { mentionedParticipants.add(String(target)); incrementEdge(edgeMap, currentParticipant, target, 'mention'); }
    });
  });
  const byChat = new Map(); records.forEach((record) => { const list = byChat.get(record.chatId) || []; list.push(record); byChat.set(record.chatId, list); });
  byChat.forEach((list) => {
    list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const timesBySender = new Map();
    for (let i = 0; i < list.length; i += 1) {
      const record = list[i]; if (!record.date) continue;
      const timestamp = new Date(record.date).getTime();
      timesBySender.forEach((timestamps, senderId) => {
        if (senderId === record.senderId) return;
        const first = lowerBound(timestamps, timestamp - timeWindowMs);
        incrementEdgeBy(edgeMap, senderId, record.senderId, 'time', timestamps.length - first);
      });
      const ownTimes = timesBySender.get(record.senderId) || [];
      ownTimes.push(timestamp); timesBySender.set(record.senderId, ownTimes);
    }
    const senders = [...new Set(list.map((record) => record.senderId).filter(Boolean))]; for (let i = 0; i < senders.length; i += 1) for (let j = i + 1; j < senders.length; j += 1) incrementEdge(edgeMap, senders[i], senders[j], 'shared');
  });
  // Chat mode gets shared-participant relations plus close activity across
  // different chats. This keeps relation-only chat mode useful when all
  // replies happen inside one chat.
  const byParticipant = new Map();
  records.forEach((record) => {
    const list = byParticipant.get(record.senderId) || [];
    list.push(record.chatId);
    byParticipant.set(record.senderId, list);
  });
  byParticipant.forEach((chatIds) => {
    const ids = [...new Set(chatIds)].sort();
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) incrementEdge(chatEdgeMap, ids[i], ids[j], 'shared');
  });
  const dated = records.filter((record) => record.date).sort((a, b) => a.date.localeCompare(b.date));
  const timesByChat = new Map();
  dated.forEach((record) => {
    const timestamp = new Date(record.date).getTime();
    timesByChat.forEach((timestamps, chatId) => {
      if (chatId === record.chatId) return;
      const first = lowerBound(timestamps, timestamp - timeWindowMs);
      incrementEdgeBy(chatEdgeMap, chatId, record.chatId, 'time', timestamps.length - first);
    });
    const ownTimes = timesByChat.get(record.chatId) || [];
    ownTimes.push(timestamp); timesByChat.set(record.chatId, ownTimes);
  });
  return { participantEdges: [...edgeMap.values()], chatEdges: [...chatEdgeMap.values()] };
}

const periodsForRecords = (records) => {
  const periodsMap = new Map();
  records.forEach((record) => {
    if (!record.date || !record.dateKey) return;
    const key = record.dateKey.slice(0, 7);
    const period = periodsMap.get(key) || { key, label: key, start: record.date, end: record.date, count: 0 };
    period.count += 1;
    if (record.date < period.start) period.start = record.date;
    if (record.date > period.end) period.end = record.date;
    periodsMap.set(key, period);
  });
  return [...periodsMap.values()].sort((a, b) => a.start.localeCompare(b.start));
};

const safeRecord = (record) => {
  const { source, ...safe } = record;
  return safe;
};

const modelFromRecords = (chats, records, mode, options = {}) => {
  const nodeSets = buildNodes(chats, records);
  const { participantEdges, chatEdges } = buildEdges(records, nodeSets, options);
  const activeMode = mode === 'participants' || mode === 'chats' ? mode : (nodeSets.chatNodes.length > 1 ? 'chats' : 'participants');
  const selectedEdges = activeMode === 'participants' ? participantEdges : chatEdges;
  const safeRecords = records.map(safeRecord);
  const relationTypes = ['reply', 'mention', 'shared', 'time'];
  const relationCounts = Object.fromEntries(relationTypes.map((type) => [type, 0]));
  selectedEdges.forEach((edge) => {
    if (Object.hasOwn(relationCounts, edge.type)) relationCounts[edge.type] += Number(edge.count || 0);
  });
  const skippedCount = Number.isFinite(Number(options.skippedCount)) ? Math.max(0, Number(options.skippedCount)) : 0;
  return {
    nodes: activeMode === 'chats' ? nodeSets.chatNodes : nodeSets.participantNodes,
    edges: selectedEdges,
    chatNodes: nodeSets.chatNodes,
    participantNodes: nodeSets.participantNodes,
    participantEdges,
    chatEdges,
    chats: nodeSets.chats,
    participants: nodeSets.participants,
    periods: periodsForRecords(records),
    messages: safeRecords,
    stats: {
      messageCount: records.length,
      chatCount: nodeSets.chatNodes.length,
      participantCount: nodeSets.participantNodes.length,
      relationCount: selectedEdges.reduce((sum, edge) => sum + edge.count, 0),
      relationCounts,
      undatedCount: records.reduce((count, record) => count + (record.dateKey ? 0 : 1), 0),
      skippedCount,
    },
    _records: safeRecords,
  };
};

const isServiceMessage = (message) => String(message?.type || '').toLowerCase() === 'service';
const senderInfo = (message, fallback) => {
  const from = message?.from;
  const author = message?.author;
  const actor = message?.actor;
  const idValue = firstValue(message?.from_id, message?.fromId, from?.id, from?.user_id, author?.id, message?.actor_id, message?.actorId, actor?.id, message?.post_author_id, message?.sender_id);
  const nameValue = firstValue(typeof from === 'string' ? from : null, from?.name, from?.title, typeof author === 'string' ? author : null, author?.name, message?.from_name, typeof actor === 'string' ? actor : null, actor?.name, message?.post_author, message?.sender_name);
  const usernameValue = firstValue(message?.username, from?.username, author?.username, actor?.username);
  return {
    id: idOf(idValue, fallback),
    name: labelOf(nameValue, idOf(idValue, fallback)),
    username: usernameValue ? String(usernameValue).replace(/^@/, '').toLowerCase() : null,
  };
};
const replyInfo = (message) => {
  const reply = message?.reply_to;
  const replyId = firstValue(message?.reply_to_message_id, reply?.message_id, reply?.messageId, reply?.id);
  const replyChatId = firstValue(message?.reply_to_chat_id, reply?.chat_id, reply?.chatId, reply?.chat?.id);
  return { replyId: replyId === undefined ? null : String(replyId), replyChatId: replyChatId === undefined ? null : String(replyChatId) };
};

export function normalizeModel(input, options = {}) {
  const parsed = parseInput(input);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const chats = extractChats(parsed);
  if (!chats.length) throw new ExportFormatError('файл прочитан, но в нём не найдены чаты или сообщения telegram desktop.', 'UNSUPPORTED_FORMAT');
  const records = [];
  let skippedCount = 0;
  const total = chats.reduce((count, chat) => count + asArray(chat.messages).length, 0);
  let processed = 0;
  chats.forEach((chat) => asArray(chat.messages).forEach((message, index) => {
    processed += 1;
    if (!isRecord(message)) {
      skippedCount += 1;
      try { onProgress({ phase: 'normalizing', processed, total: Math.max(total, 1), ratio: Math.min(1, processed / Math.max(total, 1)) }); } catch { /* a UI callback cannot invalidate data */ }
      return;
    }
    if (!isServiceMessage(message)) {
      const sender = senderInfo(message, 'unknown-sender');
      const dates = normalizedDateFields(message);
      const mentions = mentionTargets(message);
      const reply = replyInfo(message);
      records.push({
        messageId: idOf(message?.id, `${chat.id}-${index + 1}`),
        replyId: reply.replyId,
        replyChatId: reply.replyChatId,
        chatId: String(chat.id),
        senderId: sender.id,
        senderName: sender.name,
        senderUsername: sender.username,
        date: dates.date,
        dateKey: dates.dateKey,
        mentionNames: [...new Set(mentions.names)],
        mentionIds: [...new Set(mentions.ids)],
        source: message,
      });
    }
    try { onProgress({ phase: 'normalizing', processed, total: Math.max(total, 1), ratio: Math.min(1, processed / Math.max(total, 1)) }); } catch { /* a UI callback cannot invalidate data */ }
  }));
  if (!records.length) throw new ExportFormatError('в файле не найдено сообщений. нужен экспорт telegram desktop с массивом messages.', 'NO_MESSAGES');
  const model = modelFromRecords(chats, records, options.mode, { skippedCount });
  try { onProgress({ phase: 'complete', processed: 1, total: 1, ratio: 1 }); } catch { /* progress is advisory */ }
  return model;
}

export function parseExport(input, options = {}) { return normalizeModel(input, options); }

/** Recompute both relation layers from normalized metadata without raw text. */
export function deriveRelations(model, options = {}) {
  const records = asArray(model?._records || model?.messages).map((record) => ({ ...record }));
  if (!records.length) return { participantEdges: [], chatEdges: [] };
  const participantNodes = asArray(model?.participantNodes || model?.participants).map((node) => ({ ...node }));
  const chatNodes = asArray(model?.chatNodes || model?.chats).map((node) => ({ ...node }));
  return buildEdges(records, { participantNodes, chatNodes }, options);
}

const modeOf = (model, filters) => filters.mode === 'participants' || filters.mode === 'chats'
  ? filters.mode
  : (model.nodes === model.chatNodes ? 'chats' : (model.nodes === model.participantNodes ? 'participants' : (model.chatNodes?.length > 1 ? 'chats' : 'participants')));
const cleanDateBound = (value) => value ? String(value).slice(0, 10) : null;

export function filterModel(model, filters = {}) {
  const mode = modeOf(model, filters);
  const from = cleanDateBound(filters.from);
  const to = cleanDateBound(filters.to);
  const hasDateFilter = Boolean(from || to);
  const invalidDateRange = Boolean(from && to && from > to);
  const records = (invalidDateRange ? [] : asArray(model?._records || model?.messages)).filter((record) => {
    const chatMatch = !filters.chatId || filters.chatId === 'all' || String(record.chatId) === String(filters.chatId);
    const personMatch = !filters.participantId || filters.participantId === 'all' || String(record.senderId) === String(filters.participantId);
    const dateMatch = !hasDateFilter || (record.dateKey && (!from || record.dateKey >= from) && (!to || record.dateKey <= to));
    return chatMatch && personMatch && dateMatch;
  }).map((record) => ({ ...record }));
  const sourceChats = asArray(model?.chatNodes).map((node) => ({ id: String(node.id), name: node.label }));
  const filtered = modelFromRecords(sourceChats, records, mode, { skippedCount: Number(model?.stats?.skippedCount || 0) });
  if (Array.isArray(filters.relationTypes)) {
    const types = new Set(filters.relationTypes);
    filtered.participantEdges = filtered.participantEdges.filter((edge) => types.has(edge.type));
    filtered.chatEdges = filtered.chatEdges.filter((edge) => types.has(edge.type));
    filtered.edges = mode === 'chats' ? filtered.chatEdges : filtered.participantEdges;
    filtered.stats.relationCounts = Object.fromEntries(['reply', 'mention', 'shared', 'time'].map((type) => [type, 0]));
    filtered.stats.relationCount = 0;
    filtered.edges.forEach((edge) => {
      filtered.stats.relationCount += edge.count;
      filtered.stats.relationCounts[edge.type] += edge.count;
    });
  }
  return { ...model, ...filtered, filterError: invalidDateRange ? 'INVALID_DATE_RANGE' : null };
}
