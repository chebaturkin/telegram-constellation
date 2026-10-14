// Fictional names and generated messages. No network or saved user data.
export function createDemoExport() {
  const names = ['Мария', 'Алексей', 'Софья', 'Денис', 'Анна', 'Михаил', 'Ольга', 'Иван'];
  const chats = [
    ['дизайн команды', [0, 1, 2, 3]],
    ['идеи и находки', [0, 2, 4, 5]],
    ['друзья', [0, 4, 6, 7]],
    ['планы на выходные', [1, 3, 6, 7]],
    ['рабочие заметки', [0, 1, 5]],
  ];
  return { chats: { list: chats.map(([name, people], chatIndex) => {
    const messages = [];
    let id = 0;
    for (let month = 0; month < 6; month += 1) {
      const sessions = [8, 11, 17, 24, 15, 10][month] - chatIndex;
      for (let session = 0; session < sessions; session += 1) {
        const sender = people[session % people.length];
        const responder = people[(session + 1) % people.length];
        const date = new Date(Date.UTC(2026, month + 3, 2 + session, 10 + chatIndex));
        messages.push({ id: ++id, from: names[sender], from_id: `demo-${sender}`, date: date.toISOString(), text: '' });
        messages.push({ id: ++id, from: names[responder], from_id: `demo-${responder}`, date: new Date(+date + 180000).toISOString(), reply_to_message_id: id - 1, text: `@${names[sender]}` });
        if (session % 3 === 0) messages.push({ id: ++id, from: names[0], from_id: 'demo-0', date: new Date(+date + 360000).toISOString(), reply_to_message_id: id - 1, text: '' });
      }
    }
    return { id: `demo-chat-${chatIndex}`, name, type: 'group', messages };
  }) } };
}
