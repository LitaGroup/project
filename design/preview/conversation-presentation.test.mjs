import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectConversationMessages } from '../../frontend/src/lib/conversation-presentation.ts';

const message = (id, role = 'assistant', extra = {}) => ({ id, role, content: id, status: 'complete', createdAt: '2026-10-28T04:00:00Z', ...extra });
const question = (id, state = 'pending', extra = {}) => message(`q-${id}`, 'assistant', { kind: 'question', question: { id, state, askedAt: '2026-10-28T04:01:00Z', questions: [], ...extra } });
const ids = (items) => items.map((item) => item.id);

test('answered question receipt precedes the placeholder that later contains the final answer', () => {
  const raw = [message('u1', 'user'), message('answer'), question('one', 'answered')];
  const before = structuredClone(raw);
  const view = projectConversationMessages(raw, 'debug');
  assert.deepEqual(ids(view.messages), ['u1', 'q-one', 'answer']);
  assert.deepEqual(view.pendingQuestions, []);
  assert.deepEqual(raw, before, 'presentation never mutates server messages');
  assert.equal(view.messages[2], raw[1], 'original message objects are reused');
});

test('pending questions appear only in the dock, duplicate request IDs use the latest snapshot', () => {
  const raw = [message('u1', 'user'), message('a1'), question('one'), question('one', 'pending', { questions: [{ question: 'latest' }] }), question('two')];
  const view = projectConversationMessages(raw, 'debug');
  assert.deepEqual(ids(view.messages), ['u1', 'a1']);
  assert.deepEqual(ids(view.pendingQuestions), ['q-one', 'q-two']);
  assert.equal(view.pendingQuestions[0].question.questions[0].question, 'latest');
});

test('a settled snapshot replaces a pending duplicate without a stale dock card', () => {
  const view = projectConversationMessages([message('u', 'user'), message('a'), question('one'), question('one', 'answered')], 'debug');
  assert.deepEqual(ids(view.messages), ['u', 'q-one', 'a']);
  assert.equal(view.pendingQuestions.length, 0);
});

test('receipts stay inside their own user turn, including skipped and cancelled questions', () => {
  const view = projectConversationMessages([message('u1', 'user'), message('a1'), question('one', 'answered'), message('u2', 'user'), message('a2'), question('two', 'rejected'), question('three', 'cancelled')], 'debug');
  assert.deepEqual(ids(view.messages), ['u1', 'q-one', 'a1', 'u2', 'q-two', 'q-three', 'a2']);
});

test('task stage questions remain attached to the same task and sender', () => {
  const a = (id, taskId) => message(id, 'assistant', { taskId, sender: { id: `worker-${taskId}` } });
  const q = (id, taskId) => ({ ...question(id, 'answered'), taskId, sender: { id: `worker-${taskId}` } });
  const view = projectConversationMessages([message('u', 'user'), a('a1', 1), a('a2', 2), q('one', 1), q('two', 2)], 'task');
  assert.deepEqual(ids(view.messages), ['u', 'q-one', 'a1', 'q-two', 'a2']);
});

test('a question before a later result is retained and an orphan receipt keeps its position', () => {
  const view = projectConversationMessages([message('u', 'user'), question('one', 'answered'), message('a'), message('u2', 'user'), question('orphan', 'cancelled')], 'debug');
  assert.deepEqual(ids(view.messages), ['u', 'q-one', 'a', 'u2', 'q-orphan']);
});

test('system events and text are preserved; independent task questions with equal IDs stay distinct', () => {
  const raw = [message('event', 'system', { kind: 'event' }), { ...question('same'), taskId: 1 }, { ...question('same'), id: 'q-same-2', taskId: 2 }];
  const view = projectConversationMessages(raw, 'task');
  assert.deepEqual(ids(view.messages), ['event']);
  assert.equal(view.pendingQuestions.length, 2);
  assert.deepEqual(projectConversationMessages([], 'debug'), { messages: [], pendingQuestions: [] });
});
