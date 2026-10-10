import test from 'node:test';
import assert from 'node:assert/strict';
import '../static/tips.js';
import { SKILLS, makeQuestion } from '../engine.js';

test('every skill has a finite mental tip across formats and difficulty steps', () => {
  for (const skill of Object.keys(SKILLS)) for (const game of ['cash', 'tournament']) for (let d = 0; d < 6; d++) {
    for (const random of [() => 0, () => 0.49, () => 0.999]) {
      const q = makeQuestion(skill, Math.floor(d / 2), random, d, game);
      q.difficulty = d;
      const tip = PokerTips.build(q);
      assert.ok(tip.length > 25, `${skill} ${game} ${d}`);
      assert.doesNotMatch(tip, /NaN|Infinity|undefined/);
    }
  }
  assert.equal(PokerTips.build({}), '');
});

test('shortcuts preserve thirds, matched all-in totals and percentage denominators', () => {
  const base = { game: 'tournament', difficulty: 0 };
  const tip = (skill, scenario) => PokerTips.build({ ...base, skill, scenario });
  assert.match(tip('chipsToBB', { stack: 24000, blind: 600 }), /24,000 ÷ 600 becomes 240 ÷ 6/);
  assert.match(tip('betSize', { pot: 12000, percent: 33 }), /exactly 33%.*30% \+ 3%/);
  assert.match(tip('betSize', { pot: 12000, percent: 25 }), /3,000 chips/);
  assert.match(tip('betSize', { pot: 12000, percent: 125 }), /15,000 chips/);
  assert.match(tip('allInOdds', { pot: 20, bet: 10, shove: 75, heroTotal: 100 }), /65 chips to call.*170 chips/);
  assert.match(tip('shortAllInOdds', { pot: 20, bet: 10, shove: 75, heroTotal: 40 }), /Cap both players.*30 chips to call.*100 chips/);
  assert.match(tip('potOdds', { pot: 100, bet: 50 }), /25% of 200 chips/);
  assert.match(tip('bluff', { pot: 100, bet: 50 }), /of 150 chips/);
});
