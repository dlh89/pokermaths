import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { SKILLS, makeQuestion } from '../engine.js';
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../static/table.js', import.meta.url), 'utf8'), context);
const build = q => context.PokerTable.build(q);
test('table shows original pot and separate bets without leaking derived answers', () => {
  const q = { skill: 'allInOdds', game: 'tournament', difficulty: 1, unit: '%', scenario: { pot: 20, bet: 10, shove: 75, heroTotal: 100, blind: 1, call: 65, equity: 38.2, finalPot: 170 } };
  const v = build(q);
  assert.equal(v.pot, '20 BB'); assert.equal(v.potNote, 'Before these bets');
  assert.equal(v.hero.bet, '10 BB'); assert.equal(v.hero.stack, '90 BB behind');
  assert.equal(v.villain.bet, '75 BB total'); assert.equal(v.villain.allIn, true);
  assert.ok(!JSON.stringify(v).includes('65')); assert.ok(!JSON.stringify(v).includes('38.2')); assert.ok(!JSON.stringify(v).includes('170'));
  q.scenario.heroTotal = 40;
  assert.equal(build(q).hero.stack, '30 BB behind');
  assert.equal(build(q).villain.bet, '75 BB total');
});
test('all skill views use scenario inputs in both formats, and old questions fall back safely', () => {
  for (const skill of Object.keys(SKILLS)) for (const game of ['cash', 'tournament']) {
    const q = makeQuestion(skill, 0, () => 0.3, 0, game), view = build(q);
    assert.ok(view.question); assert.ok(view.rounding);
    if (q.scenario.pot) assert.equal(view.pot, game === 'cash' ? `£${q.scenario.pot.toLocaleString('en-GB')}` : `${q.scenario.pot.toLocaleString('en-GB')} chips`);
    if (skill.startsWith('draw')) assert.equal(view.facts, true);
  }
  assert.equal(build({ skill: 'allInOdds' }), null);
});
