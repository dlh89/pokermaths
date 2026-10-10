export const DAY = 86_400_000;
export const INTERVALS = [1, 3, 7, 14, 30, 60];
export const LEVELS = ['Common sizes', 'Table calculations', 'Awkward amounts'];
export const DIFFICULTIES = ['Friendly amounts', 'Common fractions', 'Mixed bet sizes', 'Mixed stacks', 'Awkward amounts', 'Table estimates'];
export const SKILLS = {
  chipsToBB: { name: 'Chips to big blinds', category: 'stacks' },
  bbToChips: { name: 'Big blinds to chips', category: 'stacks' },
  effectiveStack: { name: 'Effective stack in BB', category: 'stacks' },
  spr: { name: 'Stack-to-pot ratio', category: 'stacks' },
  betPercent: { name: 'Bet as a percentage of pot', category: 'sizing' },
  betSize: { name: 'Size a percentage-pot bet', category: 'sizing' },
  potAfterCall: { name: 'Pot after a bet and call', category: 'sizing' },
  trackPot: { name: 'Track the pot across streets', category: 'sizing' },
  potOdds: { name: 'Equity needed to call', category: 'odds' },
  allInOdds: { name: 'Your bet faces an all-in raise', category: 'odds' },
  shortAllInOdds: { name: 'All-in raise when you are shorter', category: 'odds' },
  bluff: { name: 'Break-even bluff success rate', category: 'odds' },
};
export const categoryOf = skill => SKILLS[skill]?.category;
export const format = n => String(Math.round(n * 10000) / 10000);
export function selectSkills(skill = 'all', skills) {
  if (skills !== undefined) {
    if (!Array.isArray(skills) || !skills.length || skills.length > Object.keys(SKILLS).length || skills.some(id => typeof id !== 'string' || !Object.hasOwn(SKILLS, id))) throw new Error('Choose at least one valid skill.');
    return [...new Set(skills)];
  }
  if (skill === 'all') return Object.keys(SKILLS);
  if (['stacks', 'sizing', 'odds'].includes(skill)) return Object.keys(SKILLS).filter(id => categoryOf(id) === skill);
  if (Object.hasOwn(SKILLS, skill)) return [skill];
  throw new Error('Unknown practice selection.');
}

// P is the pot BEFORE hero's bet; shove is villain's TOTAL street contribution.
// HeroTotal includes hero's bet. Uncalled excess is excluded from the final pot.
export function raisedAllIn(pot, bet, shove, heroTotal = shove) {
  if (![pot, bet, shove, heroTotal].every(n => Number.isFinite(n) && n > 0) || shove <= bet || heroTotal <= bet) throw new Error('Invalid all-in scenario');
  const matched = Math.min(shove, heroTotal), call = matched - bet;
  const finalPot = pot + 2 * matched, availablePot = finalPot - call;
  return { call, finalPot, availablePot, unmatched: shove - matched, equity: call / finalPot * 100, ratio: availablePot / call };
}

export function makeQuestion(skill, level, random = Math.random, difficulty = level * 2, game = 'both') {
  if (!Object.hasOwn(SKILLS, skill) || !Number.isInteger(level) || level < 0 || level > 2 || !Number.isInteger(difficulty) || difficulty < 0 || difficulty > 5 || Math.floor(difficulty / 2) !== level || !['both', 'cash', 'tournament'].includes(game)) throw new Error('Invalid practice selection');
  const int = (min, max) => Math.min(max, min + Math.floor(random() * (max - min + 1)));
  const pick = values => values[int(0, values.length - 1)];
  const context = game === 'both' ? pick(['cash', 'tournament']) : game;
  const blind = context === 'cash' ? pick([1, 2, 5, 10]) : pick([100, 200, 400, 500, 600, 800, 1000, 1200, 1600, 2000]);
  const round = n => context === 'cash' ? Math.round(n * 100) / 100 : Math.round(n);
  const amount = n => Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 });
  const money = n => context === 'cash' ? `£${amount(n)}` : `${amount(n)} chips`;
  const bb = difficulty < 2 ? pick([10, 20, 25, 30, 40, 50, 75, 100]) : difficulty < 4 ? int(12, 100) : int(101, 999) / 10;
  const potBB = difficulty < 2 ? pick([8, 12, 16, 20, 24, 40]) : difficulty < 4 ? int(8, 45) : int(81, 459) / 10;
  const fraction = difficulty === 0 ? pick([0.25, 0.5, 1]) : difficulty === 1 ? pick([1/3, 2/3, 0.75, 1.5]) : difficulty < 4 ? pick([0.2, 0.3, 0.4, 0.6, 0.8, 1.25, 2]) : int(21, 175) / 100;
  const pot = round(potBB * blind), bet = round(pot * fraction), stack = round(bb * blind);
  let prompt, value, unit, method, steps, scenario;
  const percentage = (question, result, tip, explanation) => {
    prompt = `${question} Give a percentage to the nearest whole percentage point.`;
    value = result; unit = '%'; method = tip; steps = explanation;
  };
  const numeric = (question, result, units, tip, explanation) => {
    prompt = question; value = result; unit = units; method = tip; steps = explanation;
  };
  if (skill === 'chipsToBB') {
    numeric(`Big blind: ${money(blind)}. Your stack: ${money(stack)}. How many big blinds? Round to 0.1 BB.`, stack / blind, 'BB', 'Divide the stack by the big blind.', `${amount(stack)} ÷ ${amount(blind)} = ${format(stack / blind)} BB.`);
    scenario = { stack, blind };
  } else if (skill === 'bbToChips') {
    const size = difficulty < 2 ? pick([2, 2.5, 3, 4, 10, 25]) : difficulty < 4 ? int(4, 80) / 2 : int(21, 299) / 10;
    numeric(`Big blind: ${money(blind)}. How much is ${format(size)} BB?`, round(size * blind), context === 'cash' ? '£' : 'chips', 'Multiply the number of big blinds by the blind amount.', `${format(size)} × ${amount(blind)} = ${money(round(size * blind))}.`);
    scenario = { size, blind };
  } else if (skill === 'effectiveStack') {
    const opponent = round((difficulty < 2 ? pick([20, 40, 60, 80]) : int(125, 1000) / 10) * blind);
    numeric(`Heads-up, before either player puts chips in: you have ${money(stack)}; villain has ${money(opponent)}. BB: ${money(blind)}. Effective stack in BB? Round to 0.1 BB.`, Math.min(stack, opponent) / blind, 'BB', 'Use the shorter stack, then divide by the big blind.', `min(${amount(stack)}, ${amount(opponent)}) ÷ ${amount(blind)} = ${format(Math.min(stack, opponent) / blind)} BB.`);
    scenario = { hero: stack, villain: opponent, blind };
  } else if (skill === 'spr') {
    const effective = difficulty < 2 ? pot * pick([1, 2, 3, 4, 5, 10]) : stack;
    numeric(`Heads-up at the start of a street: pot ${money(pot)}, effective stack remaining ${money(effective)}. What is the SPR? Round to 0.1.`, effective / pot, 'SPR', 'Divide the effective remaining stack by the pot.', `${amount(effective)} ÷ ${amount(pot)} = ${format(effective / pot)}.`);
    scenario = { pot, effective };
  } else if (skill === 'betPercent') {
    percentage(`Pot BEFORE the bet: ${money(pot)}. Bet: ${money(bet)}. What percentage of pot is the bet?`, bet / pot * 100, 'Bet ÷ pot before the bet × 100.', `${amount(bet)} ÷ ${amount(pot)} × 100 = ${format(bet / pot * 100)}%.`);
    scenario = { pot, bet };
  } else if (skill === 'betSize') {
    const percent = difficulty === 0 ? pick([25, 50, 100]) : difficulty === 1 ? pick([20, 33, 67, 75, 125, 150]) : pick([20, 25, 33, 40, 50, 67, 75, 100, 110, 125, 150, 200]);
    const size = pot * percent / 100;
    numeric(`Pot: ${money(pot)}. How much is a ${percent}%-pot bet? Round to ${context === 'cash' ? 'the nearest penny' : 'the nearest chip'}.`, context === 'cash' ? size : Math.round(size), context === 'cash' ? '£' : 'chips', 'Multiply the pot by the percentage ÷ 100.', `${amount(pot)} × ${percent} ÷ 100 = ${money(size)} before rounding.`);
    scenario = { pot, percent };
  } else if (skill === 'potAfterCall') {
    numeric(`Pot BEFORE the bet: ${money(pot)}. Villain bets ${money(bet)} and you call ${money(bet)}. No other action. What is the new pot?`, round(pot + 2 * bet), context === 'cash' ? '£' : 'chips', 'Add both the bet and the call.', `${amount(pot)} + ${amount(bet)} + ${amount(bet)} = ${money(round(pot + 2 * bet))}.`);
    scenario = { pot, bet };
  } else if (skill === 'trackPot') {
    const count = difficulty === 0 ? 1 : difficulty < 3 ? 2 : 3;
    const players = difficulty >= 3 ? ['YOU', 'VILLAIN', 'PLAYER 3'] : ['YOU', 'VILLAIN'];
    const streets = [];
    let running = pot;
    let thirdActive = players.length === 3;
    const ledger = [`Starting pot on the flop = ${money(pot)}.`];
    for (let i = 0; i < count; i++) {
      const name = ['Flop', 'Turn', 'River'][i];
      const b = round((difficulty < 2 ? pick([2, 4, 6, 10]) : difficulty < 4 ? int(3, 20) : int(31, 199) / 10) * blind);
      const contributions = { YOU: 0, VILLAIN: 0 };
      if (players.length === 3) contributions['PLAYER 3'] = 0;
      let action, returned = 0;
      if (difficulty === 5 && i === 2) {
        action = `You bet ${money(b)}. Villain folds. Your uncalled ${money(b)} is returned.`;
        returned = b;
      } else if (difficulty >= 2 && i === 1 && pick([false, true])) {
        action = 'You check. Villain checks.';
      } else if (difficulty >= 4 && i === 0) {
        const total = round(b * pick([2, 3]));
        contributions.YOU = total; contributions.VILLAIN = total;
        if (players.length === 3) contributions['PLAYER 3'] = total;
        action = `You bet ${money(b)}. Villain raises to ${money(total)} total. ${players.length === 3 ? `Player 3 calls ${money(total)}. ` : ''}You call another ${money(round(total - b))}.`;
      } else {
        contributions.YOU = b; contributions.VILLAIN = b;
        if (players.length === 3 && i === 0) contributions['PLAYER 3'] = b;
        action = `You bet ${money(b)}. Villain calls ${money(b)}.${players.length === 3 && i === 0 ? ` Player 3 calls ${money(b)}.` : ''}`;
      }
      if (thirdActive && i > 0) {
        if (action.includes('Villain checks.')) action = `Player 3 checks. ${action}`;
        else { action = `Player 3 checks. ${action} Player 3 folds to your bet.`; thirdActive = false; }
      }
      if (returned) action = `${action.replace(` Your uncalled ${money(b)} is returned.`, '')} Your uncalled ${money(b)} is returned.`;
      const addition = round(Object.values(contributions).reduce((sum, n) => sum + n, 0));
      streets.push({ name, action, contributions, returned, thirdFolded: players.length === 3 && !thirdActive });
      ledger.push(`${name}: ${Object.values(contributions).map(money).join(' + ')} = ${money(addition)} added. Pot = ${money(running)} + ${money(addition)} = ${money(round(running + addition))}.${returned ? ` Uncalled ${money(returned)} is returned, so it adds nothing.` : ''}`);
      running = round(running + addition);
    }
    const target = count < 3 ? ['turn', 'river'][count - 1] : 'end of the river';
    numeric(`Starting pot on the flop: ${money(pot)}. ${streets.map(street => `${street.name}: ${street.action}`).join(' ')} What is the pot at the ${target}? Ignore rake.`, running, context === 'cash' ? '£' : 'chips', 'Carry the pot forward and add each player’s final contribution on each street.', ledger.join('\n'));
    scenario = { startingPot: pot, players, streets, target };
  } else if (skill === 'potOdds') {
    percentage(`Heads-up: pot BEFORE villain bets is ${money(pot)}. Villain bets ${money(bet)} all-in; you cover. What equity is needed to break even on a call? Ignore rake and tournament payouts.`, bet / (pot + 2 * bet) * 100, 'Call ÷ final pot after your call × 100.', `Call ${money(bet)}. Final pot = ${amount(pot)} + 2 × ${amount(bet)} = ${money(round(pot + 2 * bet))}. Required equity = ${format(bet / (pot + 2 * bet) * 100)}%.`);
    scenario = { pot, bet };
  } else if (['allInOdds', 'shortAllInOdds'].includes(skill)) {
    // Amounts on this street only. Generate legal raises (at least twice hero's bet).
    const shove = difficulty < 2 ? round(Math.max(bet * 2, pick([25, 50, 75, 100]) * blind)) : round(Math.max(bet * 2, bb * blind));
    const heroTotal = skill === 'shortAllInOdds' ? round(bet + (shove - bet) * pick([0.25, 0.5, 0.75])) : shove + 20 * blind;
    const result = raisedAllIn(pot, bet, shove, heroTotal);
    const show = n => difficulty % 2 ? `${format(n / blind)} BB` : money(n);
    percentage(`Heads-up: pot BEFORE your bet is ${show(pot)}. You bet ${show(bet)}. You now have ${show(round(heroTotal - bet))} left. Villain had ${show(shove)} remaining before acting and raises all-in to ${show(shove)} TOTAL on this street. What equity is needed to break even on a call? Ignore rake and tournament payouts.`, result.equity,
      'Subtract your bet from the matched total. Divide that extra call by the final matched pot.',
      `Matched total per player = ${show(Math.min(shove, heroTotal))}. Extra call = ${show(round(result.call))}. ${result.unmatched > 0 ? `Villain’s unmatched ${show(round(result.unmatched))} is returned. ` : ''}Final pot = ${show(pot)} + 2 × ${show(Math.min(shove, heroTotal))} = ${show(round(result.finalPot))}. Extra call ÷ final pot × 100 = ${format(result.equity)}%. Pot odds are ${format(result.ratio)}:1 (pot available before your call : extra call).`);
    scenario = { pot, bet, shove, heroTotal, ...result };
  } else if (skill === 'bluff') {
    percentage(`Pot BEFORE your bet: ${money(pot)}. You bluff ${money(bet)}. You always lose when called, with no further betting. How often must everyone fold for your bluff to break even? Ignore rake and tournament payouts.`, bet / (pot + bet) * 100, 'Risk ÷ (risk + reward) × 100.', `Risk = ${money(bet)}; reward = the existing ${money(pot)} pot. ${amount(bet)} ÷ (${amount(bet)} + ${amount(pot)}) × 100 = ${format(bet / (pot + bet) * 100)}%. This differs from calling odds.`);
    scenario = { pot, bet };
  }
  const answerNumber = unit === '%' ? Math.round(value) : ['BB', 'SPR'].includes(unit) ? Math.round(value * 10) / 10 : unit === 'chips' ? Math.round(value) : round(value);
  const answer = format(answerNumber), displayAnswer = amount(answerNumber);
  const answerLabel = unit === '£' ? `£${displayAnswer}` : `${displayAnswer}${unit === '%' ? '%' : ` ${unit}`}`;
  return { skill, level, label: SKILLS[skill].name, prompt, answer, answerLabel, unit,
    tolerance: unit === '%' ? 1 : ['BB', 'SPR'].includes(unit) ? 0.1 : unit === 'chips' ? 0.5 : 0.005,
    method, steps, scenario: { ...scenario, blind }, game: context, contextLabel: context === 'cash' ? 'Cash game' : 'Tournament' };
}

export function schedule(previous, rating, now, retry = false) {
  const state = { ...previous }, today = Math.floor(now / DAY), newDay = state.last_day !== today;
  if (rating === 'missed') Object.assign(state, { step: -1, due: now + 300_000, comfortable_days: 0 });
  else if (rating === 'slow') Object.assign(state, { step: Math.max(-1, state.step - 1), due: now + DAY, comfortable_days: 0 });
  else if (rating === 'comfortable') {
    if (newDay && !retry) { state.step = Math.min(state.step + 1, INTERVALS.length - 1); state.comfortable_days++; state.due = now + INTERVALS[Math.max(0, state.step)] * DAY; }
    else if (retry || state.due <= now || state.step === -1) state.due = now + DAY;
  } else throw new Error('Unknown rating');
  state.last_day = today; state.attempts++; return state;
}
