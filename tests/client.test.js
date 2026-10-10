import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../static/app.js', import.meta.url), 'utf8');
const question = { id: 'first', skill: 'chipsToBB', level: 0, prompt: 'BB 200, stack 2400: how many BB?', answer: '12', unit: 'BB', answerLabel: '12 BB', tolerance: 0.1, method: 'Divide the stack by the big blind.', steps: '2400 ÷ 200 = 12 BB.' };
const next = { ...question, id: 'second', prompt: 'BB 200, stack 4200: how many BB?', answer: '21', answerLabel: '21 BB' };

// Execute the actual browser controller with a minimal DOM and a controllable network.
// These tests exercise its click handler and local recovery queue, not a duplicate implementation.
function client(fetch, saved, viewport) {
  const elements = new Map();
  let now = 1000;
  const windowEvents = {};
  const element = () => ({ hidden: false, disabled: false, value: '', dataset: {}, style: { setProperty(name, value) { this[name] = value; } },
    classList: { toggle() {} }, addEventListener(type, callback) { this[type] = callback; }, append() {}, replaceChildren() {}, scrollIntoView(options) { this.scrolled = options; } });
  const ratings = ['missed', 'slow', 'comfortable'].map(rating => ({ ...element(), dataset: { rating } }));
  let stored = saved || JSON.stringify({ pending: [], count: 0, mode: 'daily', skill: 'chipsToBB', question, revealed: true });
  const context = vm.createContext({ fetch, AbortSignal, console, Date: class extends Date { static now() { return now; } },
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      querySelectorAll() { return ratings; }, createElement: element,
    }, window: { innerHeight: 800, visualViewport: viewport, addEventListener(type, callback) { windowEvents[type] = callback; }, matchMedia() { return { matches: true }; } },
    localStorage: { getItem() { return stored; }, setItem(key, value) { stored = value; } },
  });
  vm.runInContext(readFileSync(new URL('../static/table.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(new URL('../static/tips.js', import.meta.url), 'utf8'), context);
  vm.runInContext(source.replace(/run\(resume\);\s*$/, '') + `
    state = { skills: [{ id: 'chipsToBB', category: 'stacks' }], levels: ['Friendly numbers'] };
    globalThis.testControls = { flush, nextQuestion };
  `, context);
  return { ratings, controls: context.testControls, stored: () => JSON.parse(stored), elements, windowEvents, advance(ms) { now += ms; } };
}
const response = data => ({ ok: true, json: async () => data });

test('answer calculations render on separate lines without splitting decimals', async () => {
  const lines = [
    'Matched total per player = £500.',
    'Extra call = £400.',
    'Final pot = £400 + 2 × £500 = £1,400.',
    'Extra call ÷ final pot × 100 = 28.5714%.',
    'Pot odds are 2.5:1 (pot available before your call : extra call).',
  ];
  const app = client(async () => response({ ok: true, next: { ...next, steps: lines.join(' ') } }));
  await app.ratings[2].onclick();
  app.elements.get('answer-form').submit({ preventDefault() {} });
  assert.equal(app.elements.get('steps').textContent, lines.join('\n'));
});

test('large revealed answers use thousands separators even with an older saved label', async () => {
  const q = { ...next, answer: '100000', answerLabel: '100000 chips', unit: 'chips' };
  const app = client(async () => response({ ok: true, next: q }));
  await app.ratings[2].onclick();
  app.elements.get('answer-form').submit({ preventDefault() {} });
  assert.equal(app.elements.get('answer').textContent, '100,000 chips');
  assert.equal(app.stored().question.answer, '100000');
});

test('mobile controls follow the visible viewport when the keyboard opens and closes', () => {
  const events = {};
  const viewport = { height: 450, offsetTop: 20, addEventListener(type, callback) { events[type] = callback; } };
  const app = client(async () => response({}), undefined, viewport);
  const dock = app.elements.get('workspace').style;
  assert.equal(dock['--controls-bottom'], '330px');
  viewport.height = 800; viewport.offsetTop = 0; events.resize();
  assert.equal(dock['--controls-bottom'], '0px');
  viewport.height = 500; viewport.offsetTop = 100; events.scroll();
  assert.equal(dock['--controls-bottom'], '200px');
  viewport.offsetTop = 400; app.windowEvents.resize();
  assert.equal(dock['--controls-bottom'], '0px');
});

test('rating advances in one request, waits for save acknowledgement and ignores a double click', async () => {
  const calls = []; let release;
  const app = client(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    await new Promise(resolve => { release = resolve; });
    return response({ ok: true, next });
  });
  const action = app.ratings[2].onclick();
  await app.ratings[2].onclick();
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/review-next');
  assert.equal(app.stored().question.id, 'first'); assert.equal(app.stored().pending.length, 1);
  assert.equal(app.elements.get('question-card')?.scrolled, undefined);
  release(); await action;
  assert.equal(calls.length, 1); assert.equal(app.stored().question.id, 'second');
  assert.equal(app.stored().pending.length, 0); assert.equal(app.stored().count, 1);
  assert.equal(app.elements.get('question').textContent, next.prompt);
  assert.equal(app.elements.get('question-card').scrolled.block, 'start');
});

test('real controller fills table labels and hides the table when the next question has no scenario', async () => {
  const tableQuestion = { ...next, skill: 'allInOdds', difficulty: 1, scenario: { pot: 20, bet: 10, shove: 75, heroTotal: 100, blind: 1 }, game: 'tournament', unit: '%' };
  let calls = 0;
  const app = client(async () => response({ ok: true, next: calls++ ? next : tableQuestion }));
  await app.ratings[2].onclick();
  assert.equal(app.elements.get('table-view').hidden, false);
  assert.equal(app.elements.get('pot-amount').textContent, '20 BB');
  assert.equal(app.elements.get('villain-bet-amount').textContent, '75 BB total');
  assert.equal(app.elements.get('hero-stack').textContent, '90 BB behind');
  assert.equal(app.elements.get('answer-panel').hidden, true);
  app.elements.get('answer-form').submit({ preventDefault() {} });
  assert.equal(app.elements.get('answer-panel').hidden, false);
  assert.equal(app.elements.get('mental-tip-panel').hidden, false);
  assert.match(app.elements.get('mental-tip').textContent, /65 BB to call/);
  assert.equal(app.elements.get('answer-panel').scrolled.block, 'start');
  await app.ratings[2].onclick();
  assert.equal(app.elements.get('table-view').hidden, true);
  assert.equal(app.elements.get('mental-tip-panel').hidden, true);
});

test('lost response keeps the queued answer across reload, then clears it only after acknowledgement', async () => {
  const app = client(async () => { throw new Error('Connection lost'); });
  await app.ratings[0].onclick();
  const saved = app.stored();
  assert.equal(saved.count, 0); assert.equal(saved.pending[0].id, 'first');
  const reloaded = client(async (url, options) => {
    assert.equal(JSON.parse(options.body).id, 'first');
    return response({ ok: true, alreadySaved: true, next: { ...next, retry: true } });
  }, JSON.stringify(saved));
  await reloaded.controls.nextQuestion(await reloaded.controls.flush(true));
  assert.equal(reloaded.stored().count, 1); assert.equal(reloaded.stored().pending.length, 0);
  assert.equal(reloaded.stored().question.retry, true);
});

test('tenth answer requests outstanding retries and can finish without a follow-up fetch', async () => {
  let requests = 0;
  const app = client(async (url, options) => {
    requests++; assert.equal(JSON.parse(options.body).practice.retryOnly, true);
    return response({ ok: true, next: { done: true, nextDue: Date.now() + 86400000 } });
  }, JSON.stringify({ pending: [], count: 9, mode: 'daily', skill: 'chipsToBB', question, revealed: true }));
  await app.ratings[2].onclick();
  assert.equal(requests, 1); assert.equal(app.stored().count, 10);
  assert.equal(app.elements.get('finish').hidden, false);
});

test('timing stops at reveal, excludes save latency, and survives a lost response', async () => {
  const calls = [];
  const app = client(async (url, options) => {
    calls.push(JSON.parse(options.body));
    if (calls.length === 1) return response({ ok: true, next });
    throw new Error('Offline');
  });
  await app.ratings[2].onclick();
  app.advance(2300);
  app.elements.get('answer-form').submit({ preventDefault() {} });
  app.advance(10000);
  await app.ratings[2].onclick();
  assert.equal(calls[1].elapsedMs, 2300);
  assert.equal(calls[1].answerMode, 'mental');
  assert.equal(app.stored().pending[0].elapsedMs, 2300);
});

test('focus loss omits timing and switching answer mode cannot reveal a second attempt', async () => {
  const calls = [];
  const app = client(async (url, options) => { calls.push(JSON.parse(options.body)); return response({ ok: true, next }); });
  await app.ratings[2].onclick();
  app.advance(1000); app.windowEvents.blur(); app.advance(5000);
  app.elements.get('answer-form').submit({ preventDefault() {} });
  app.elements.get('typed').checked = true;
  app.elements.get('typed').onchange();
  assert.equal(app.elements.get('typed').checked, false);
  await app.ratings[2].onclick();
  assert.equal(calls[1].elapsedMs, null);
  assert.equal(calls[1].answerMode, 'mental');
});

test('typed estimates respect question tolerance and incorrect answers cannot be marked comfortable', async () => {
  for (const [entry, expected] of [['32.9', 'comfortable'], ['30', 'missed']]) {
    let posted;
    const q = { ...question, skill: 'potOdds', answer: '33', unit: '%', tolerance: 1 };
    const app = client(async (url, options) => { posted = JSON.parse(options.body); return response({ ok: true, next: { done: true } }); },
      JSON.stringify({ pending: [], count: 0, mode: 'daily', skill: 'all', typed: true, question: q, revealed: false }));
    app.elements.get('answer-input').value = entry;
    app.elements.get('answer-form').submit({ preventDefault() {} });
    await app.ratings[2].onclick();
    assert.equal(posted.rating, expected);
    assert.equal(posted.answerMode, 'typed');
  }
});
