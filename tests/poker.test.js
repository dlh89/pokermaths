import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { SKILLS, makeQuestion, raisedAllIn, DAY } from '../engine.js';
import { createApp } from '../server.js';
import { setPassword } from '../auth.js';
import { openDatabase, recordReview, progressMeasurements } from '../db.js';
import { nextQuestion, parsePractice } from '../questions.js';

test('all-in odds subtract hero’s existing bet and exclude unmatched excess', () => {
  const full = raisedAllIn(20, 10, 75);
  assert.equal(full.call, 65); assert.equal(full.finalPot, 170);
  assert.equal(full.availablePot, 105); assert.equal(full.unmatched, 0);
  assert.ok(Math.abs(full.equity - 38.2352941176) < 1e-8);
  const shorter = raisedAllIn(20, 10, 75, 40);
  assert.equal(shorter.call, 30); assert.equal(shorter.finalPot, 100);
  assert.equal(shorter.unmatched, 35); assert.equal(shorter.equity, 30);
  assert.throws(() => raisedAllIn(20, 10, 5));
});

test('all skills and difficulty steps yield correct answers in both game formats', () => {
  // Independent formulas from the raw scenario, before question rounding.
  const formulas = {
    chipsToBB: s => s.stack / s.blind, bbToChips: s => s.size * s.blind,
    effectiveStack: s => Math.min(s.hero, s.villain) / s.blind,
    spr: s => s.effective / s.pot, betPercent: s => s.bet / s.pot * 100,
    betSize: s => s.pot * s.percent / 100, potAfterCall: s => s.pot + 2 * s.bet,
    potOdds: s => s.bet / (s.pot + 2 * s.bet) * 100,
    allInOdds: s => (s.shove - s.bet) / (s.pot + 2 * s.shove) * 100,
    shortAllInOdds: s => (s.heroTotal - s.bet) / (s.pot + 2 * s.heroTotal) * 100,
    bluff: s => s.bet / (s.pot + s.bet) * 100,
    drawOne: s => 2 * s.outs, drawTwo: s => 4 * s.outs,
  };
  for (const skill of Object.keys(SKILLS)) for (let d = 0; d < 6; d++) for (const game of ['cash', 'tournament']) {
    for (let n = 0; n < 80; n++) {
      const q = makeQuestion(skill, Math.floor(d / 2), Math.random, d, game);
      let expected = formulas[skill](q.scenario);
      expected = q.unit === '%' || q.unit === 'chips' ? Math.round(expected) : ['BB', 'SPR'].includes(q.unit) ? Math.round(expected * 10) / 10 : Math.round(expected * 100) / 100;
      assert.ok(Math.abs(Number(q.answer) - expected) < 1e-8, `${skill}: ${q.prompt}`);
      assert.equal(q.game, game); assert.ok(Number(q.answer) >= 0);
      assert.ok(q.method && q.steps && q.answerLabel);
      if (skill.includes('AllIn') || skill === 'allInOdds') {
        assert.ok(q.scenario.shove >= q.scenario.bet * 2);
        assert.ok(q.scenario.call > 0);
      }
    }
  }
});

test('calling and bluffing use distinct denominators and draws clearly state the horizon', () => {
  const call = makeQuestion('potOdds', 0, () => 0), bluff = makeQuestion('bluff', 0, () => 0);
  assert.equal(call.answer, '17'); assert.equal(bluff.answer, '20'); // quarter-pot bet
  assert.match(call.prompt, /BEFORE/); assert.match(call.prompt, /all-in/);
  const draw = makeQuestion('drawTwo', 0, () => 0);
  assert.match(draw.prompt, /both remaining cards guaranteed/);
  assert.match(draw.method, /rough shortcut/);
  assert.equal(draw.answer, '16');
  const bbRaise = makeQuestion('allInOdds', 0, () => 0, 1, 'tournament');
  assert.match(bbRaise.prompt, /BB/); assert.match(bbRaise.steps, /BB/);
  assert.ok(!bbRaise.steps.includes('chips'));
  assert.throws(() => parsePractice({ game: 'unknown' }));
  assert.throws(() => parsePractice({ skills: [] }));
});

test('authenticated API saves once, retries misses, filters formats and backs up a separate database', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'poker-api-'));
  const app = createApp({ dataDir: dir });
  await setPassword(app.db, 'poker-test-password', 'david');
  t.after(() => { app.db.close(); rmSync(dir, { recursive: true, force: true }); });
  let cookie = '';
  // Exercise the real HTTP handler with streamed request bodies without requiring
  // a loopback socket (the desktop sandbox can prohibit outbound loopback traffic).
  const call = async (route, body, origin = 'http://127.0.0.1:8766') => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url: `/api/${route}`, method: body === undefined ? 'GET' : 'POST', headers: { cookie, origin, 'x-maths-request': '1', 'content-type': 'application/json' } });
    let status, headers, bytes;
    const res = { headersSent: false, writeHead(code, fields) { status = code; headers = fields; this.headersSent = true; }, end(data) { bytes = data; } };
    await app.server.listeners('request')[0](req, res);
    return { status, headers: { get(name) { return Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]; } }, json: async () => JSON.parse(bytes.toString()) };
  };
  assert.equal((await call('state')).status, 401);
  assert.equal((await call('login', { username: 'david', password: 'poker-test-password' }, 'https://example.invalid')).status, 403);
  const login = await call('login', { username: 'david', password: 'poker-test-password' });
  assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^poker_session=/);
  const q = await (await call('question', { skill: 'allInOdds', game: 'tournament' })).json();
  assert.equal(q.game, 'tournament'); assert.equal(q.skill, 'allInOdds');
  const body = { id: q.id, rating: 'missed', elapsedMs: 8500, answerMode: 'typed', practice: { skill: 'allInOdds', game: 'cash' } };
  assert.equal((await call('review-next', { ...body, elapsedMs: -1 })).status, 400);
  assert.equal((await call('review-next', { ...body, practice: { game: 'invalid' } })).status, 400);
  assert.equal((await (await call('state')).json()).total, 0);
  const saved = await (await call('review-next', body)).json();
  assert.equal(saved.next.retry, true); assert.equal(saved.next.game, 'cash');
  await call('review-next', body);
  assert.equal((await (await call('state')).json()).total, 1);
  await call('review', { id: saved.next.id, rating: 'comfortable', elapsedMs: 3000, answerMode: 'mental' });
  const state = await (await call('state')).json();
  assert.equal(state.skills.length, 13); assert.equal(state.difficulties.length, 6);
  assert.equal(state.measurements.reduce((n, m) => n + m.recent.attempts, 0), 1);
  const destination = path.join(dir, 'backup.sqlite3');
  execFileSync(process.execPath, ['scripts/admin.js', 'backup', destination], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATA_DIR: dir }, stdio: 'pipe' });
  assert.equal(app.db.prepare('PRAGMA database_list').get().file.endsWith('poker.sqlite3'), true);
  await call('logout', {}); assert.equal((await call('state')).status, 401);
});

test('gradual progression reaches six steps and excludes retry success from promotion', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'poker-progress-')), db = openDatabase(dir);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const practice = parsePractice({ skill: 'potOdds', game: 'both' });
  const initial = nextQuestion(db, practice, 100 * DAY);
  recordReview(db, initial.id, 'missed', 100 * DAY);
  const retry = nextQuestion(db, practice, 101 * DAY);
  recordReview(db, retry.id, 'comfortable', 101 * DAY);
  assert.equal(db.prepare("SELECT comfortable_days FROM bands WHERE skill='potOdds'").get().comfortable_days, 0);
  for (let day = 102; day < 502; day++) {
    const q = nextQuestion(db, practice, day * DAY);
    if (!q.done) recordReview(db, q.id, 'comfortable', day * DAY, { answerMode: 'mental', elapsedMs: 5000 });
  }
  assert.equal(db.prepare("SELECT stage FROM bands WHERE skill='potOdds' AND level=2").get().stage, 1);
  assert.ok(progressMeasurements(db).some(m => m.difficulty === 5));
});
