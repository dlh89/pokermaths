import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { SKILLS, makeQuestion, raisedAllIn, geometricFraction, DAY } from '../engine.js';
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

test('geometric sizing exhausts the effective stack over both two and three streets', () => {
  assert.equal(geometricFraction(20, 30, 2), 0.5);
  assert.equal(geometricFraction(20, 70, 3), 0.5);
  assert.equal(geometricFraction(20, 80, 2), 1);
  assert.equal(geometricFraction(20, 260, 3), 1);
  assert.throws(() => geometricFraction(20, 30, 1));
  for (const game of ['cash', 'tournament']) for (let d = 0; d < 6; d++) {
    const seen = new Set();
    for (const r of [0, 0.49, 0.999]) {
      const q = makeQuestion('geometricSizing', Math.floor(d / 2), () => r, d, game);
      const s = q.scenario, fraction = geometricFraction(s.pot, s.effective, s.streets);
      if (s.streets === 3) assert.ok(s.effective >= s.pot);
      let pot = s.pot, remaining = s.effective;
      for (let i = 0; i < s.streets; i++) {
        const bet = fraction * pot;
        assert.ok(bet <= remaining + 1e-6);
        remaining -= bet; pot += 2 * bet;
      }
      assert.ok(Math.abs(remaining) < 1e-6);
      assert.ok(Math.abs(pot - (s.pot + 2 * s.effective)) < 1e-6);
      assert.equal(Number(q.answer), Math.round(fraction * 100));
      assert.match(q.prompt, /SAME percentage of the CURRENT pot/);
      assert.match(q.steps, /adjust the final shove/);
      seen.add(s.streets);
    }
    assert.deepEqual([...seen].sort(), [2, 3]);
  }
});

test('shallow geometric sizing scenarios use two streets instead of three', () => {
  for (const game of ['cash', 'tournament']) for (const d of [4, 5]) {
    // Select a low stack, a high pot and initially three streets.
    const draws = [0, 0, 0.999, 0, 0.999];
    const q = makeQuestion('geometricSizing', 2, () => draws.shift() ?? 0, d, game);
    assert.ok(q.scenario.effective < q.scenario.pot);
    assert.equal(q.scenario.streets, 2);
    assert.deepEqual(q.scenario.streetNames, ['Turn', 'River']);
    assert.match(q.prompt, /before any turn bets/);
    assert.match(q.prompt, /2 streets left/);
  }
});

test('raise-to totals include the hypothetical call and generated raises are legal', () => {
  const draws = [0.5, 0, 0.5, 0.4];
  const q = makeQuestion('raiseTo', 0, () => draws.shift() ?? 0, 0, 'cash');
  assert.equal(q.scenario.pot, 100); assert.equal(q.scenario.bet, 50);
  assert.equal(q.answer, '250');
  assert.match(q.prompt, /TOTAL.*raise TO/);
  for (const skill of ['raiseTo', 'amountToCall']) for (let d = 0; d < 6; d++) for (const game of ['cash', 'tournament']) {
    for (const r of [0, 0.49, 0.999]) {
      const q = makeQuestion(skill, Math.floor(d / 2), () => r, d, game);
      if (skill === 'raiseTo') assert.ok(Number(q.answer) + 1e-6 >= 2 * q.scenario.bet);
      else {
        assert.ok(q.scenario.raiseTo >= 2 * q.scenario.bet);
        assert.ok(Math.abs(Number(q.answer) + q.scenario.bet - q.scenario.raiseTo) < 1e-6);
      }
    }
  }
});

test('all skills and difficulty steps yield correct answers in both game formats', () => {
  // Independent formulas from the raw scenario, before question rounding.
  const formulas = {
    chipsToBB: s => s.stack / s.blind, bbToChips: s => s.size * s.blind,
    effectiveStack: s => Math.min(s.hero, s.villain) / s.blind,
    spr: s => s.effective / s.pot, betPercent: s => s.bet / s.pot * 100,
    betSize: s => s.pot * s.percent / 100, potAfterCall: s => s.pot + 2 * s.bet,
    raiseTo: s => s.bet + (s.pot + 2 * s.bet) * s.percent / 100,
    amountToCall: s => s.raiseTo - s.bet,
    geometricSizing: s => (Math.pow((s.pot + 2 * s.effective) / s.pot, 1 / s.streets) - 1) * 50,
    potOdds: s => s.bet / (s.pot + 2 * s.bet) * 100,
    allInOdds: s => (s.shove - s.bet) / (s.pot + 2 * s.shove) * 100,
    shortAllInOdds: s => (s.heroTotal - s.bet) / (s.pot + 2 * s.heroTotal) * 100,
    bluff: s => s.bet / (s.pot + s.bet) * 100,
    trackPot: s => s.startingPot + s.streets.reduce((sum, street) => sum + Object.values(street.contributions).reduce((a, b) => a + b, 0), 0),
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

test('bet sizing retains preferred sizes at higher levels and excludes unwanted sizes', () => {
  for (let d = 0; d < 6; d++) {
    const expected = d === 0 ? [25, 50, 100] : d === 1 ? [20, 33, 67, 75, 125, 150] : [20, 25, 33, 40, 50, 67, 75, 100, 110, 125, 150, 200];
    const seen = new Set();
    for (const game of ['cash', 'tournament']) for (let i = 0; i < 1000; i++) {
      const q = makeQuestion('betSize', Math.floor(d / 2), () => i / 1000, d, game);
      assert.ok(expected.includes(q.scenario.percent));
      seen.add(q.scenario.percent);
    }
    assert.deepEqual([...seen].sort((a, b) => a - b), [...expected].sort((a, b) => a - b));
  }
});

test('tracking ledgers count raises once, return uncalled bets, and assisted answers do not promote', t => {
  for (const game of ['cash', 'tournament']) {
    const q = makeQuestion('trackPot', 2, () => 0, 5, game);
    const [flop, turn, river] = q.scenario.streets;
    assert.match(flop.action, /raises to/);
    assert.equal(new Set(Object.values(flop.contributions)).size, 1);
    assert.match(river.action, /uncalled.*returned/);
    assert.equal(Object.values(river.contributions).reduce((a, b) => a + b, 0), 0);
    assert.ok(river.returned > 0);
    assert.ok(Number(q.answer) > q.scenario.startingPot);
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'poker-assisted-')), db = openDatabase(dir);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const q = nextQuestion(db, parsePractice({ skill: 'trackPot', mode: 'free' }), 100 * DAY);
  recordReview(db, q.id, 'comfortable', 100 * DAY, { assisted: true, elapsedMs: 5000, answerMode: 'mental' });
  const review = db.prepare('SELECT * FROM reviews WHERE question_id=?').get(q.id);
  assert.equal(review.assisted, 1); assert.equal(review.first_attempt, 0);
  assert.equal(review.rating, 'slow'); assert.equal(review.elapsed_ms, null);
  assert.equal(db.prepare("SELECT comfortable_days FROM bands WHERE skill='trackPot'").get().comfortable_days, 0);
});

test('calling and bluffing use distinct denominators', () => {
  const call = makeQuestion('potOdds', 0, () => 0), bluff = makeQuestion('bluff', 0, () => 0);
  assert.equal(call.answer, '17'); assert.equal(bluff.answer, '20'); // quarter-pot bet
  assert.match(call.prompt, /BEFORE/); assert.match(call.prompt, /all-in/);
  const bbRaise = makeQuestion('allInOdds', 0, () => 0, 1, 'tournament');
  assert.match(bbRaise.prompt, /BB/); assert.match(bbRaise.steps, /BB/);
  assert.ok(!bbRaise.steps.includes('chips'));
  assert.throws(() => parsePractice({ game: 'unknown' }));
  assert.throws(() => parsePractice({ skills: [] }));
});

test('authenticated API saves once, retries misses, filters formats and backs up a separate database', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'poker-api-'));
  const app = createApp({ dataDir: dir });
  // Simulate an existing installation: retired skill rows must remain stored
  // without appearing in due counts or being selected for new practice.
  for (const skill of ['drawOne', 'drawTwo']) app.db.prepare('INSERT INTO bands(skill,level) VALUES (?,0)').run(skill);
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
  assert.equal(state.skills.length, 15); assert.equal(state.difficulties.length, 6);
  assert.ok(state.bands.every(b => !b.skill.startsWith('draw')));
  assert.equal(state.due, state.bands.filter(b => b.due <= state.now).length);
  assert.equal(app.db.prepare("SELECT count(*) AS n FROM bands WHERE skill IN ('drawOne','drawTwo')").get().n, 2);
  const mixed = await (await call('question', { skill: 'all', mode: 'free' })).json();
  assert.ok(!mixed.skill.startsWith('draw'));
  assert.equal((await call('question', { skill: 'drawOne' })).status, 400);
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
