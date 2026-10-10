// The view uses only question inputs: no call amount, final pot or equity answer.
globalThis.PokerTable = {
  build(q) {
    const s = q.scenario;
    if (!s) return null; // Already-open questions from before table support.
    const fmt = n => Number(n).toLocaleString('en-GB', { maximumFractionDigits: 4 });
    const cash = q.game === 'cash';
    const inBB = ['allInOdds', 'shortAllInOdds'].includes(q.skill) && q.difficulty % 2 === 1;
    if (inBB && !s.blind) return null;
    const amount = n => inBB ? `${fmt(n / s.blind)} BB` : cash ? `£${fmt(n)}` : `${fmt(n)} chips`;
    const player = (name, stack = '', bet = '', allIn = false) => ({ name, stack, bet, allIn });
    const view = { hero: player('YOU'), villain: null, pot: s.pot == null ? '' : amount(s.pot),
      potLabel: 'Pot', potNote: 'Before these bets', action: '', question: '', note: '',
      blind: s.blind && !inBB ? `Big blind: ${amount(s.blind)}` : '', facts: false };
    switch (q.skill) {
      case 'chipsToBB':
        view.hero.stack = amount(s.stack); view.potNote = ''; view.action = 'Your stack';
        view.question = 'How many big blinds do you have?'; break;
      case 'bbToChips':
        view.potLabel = 'Target size'; view.pot = `${fmt(s.size)} BB`; view.potNote = '';
        view.question = 'How much is this in money or chips?'; break;
      case 'effectiveStack':
        view.hero.stack = amount(s.hero); view.villain = player('VILLAIN', amount(s.villain));
        view.potNote = ''; view.action = 'Stacks before either player puts chips in';
        view.question = 'What is the effective stack in BB?'; break;
      case 'spr':
        view.hero = player('EFFECTIVE STACK', `${amount(s.effective)} behind`);
        view.potNote = 'At the start of the street'; view.question = 'What is the stack-to-pot ratio?'; break;
      case 'betPercent':
        view.villain = player('VILLAIN', '', amount(s.bet));
        view.action = `Villain bets ${amount(s.bet)}`; view.question = 'What percentage of pot is this bet?'; break;
      case 'betSize':
        view.potNote = 'Before your bet'; view.action = `Your target: ${fmt(s.percent)}% of pot`;
        view.question = `How much is a ${fmt(s.percent)}%-pot bet?`; break;
      case 'potAfterCall':
        view.villain = player('VILLAIN', '', amount(s.bet)); view.hero.bet = amount(s.bet);
        view.action = `Villain bets ${amount(s.bet)} → You call`;
        view.question = 'What is the pot after this bet and call?'; break;
      case 'potOdds':
        view.villain = player('VILLAIN', '0 behind', amount(s.bet), true); view.hero.stack = 'You cover';
        view.action = `Villain shoves ${amount(s.bet)}`;
        view.question = 'What equity do you need to call?';
        view.note = 'Chip maths · Ignore rake and tournament payouts'; break;
      case 'allInOdds': case 'shortAllInOdds':
        view.hero = player('YOU', `${amount(s.heroTotal - s.bet)} behind`, amount(s.bet));
        view.villain = player('VILLAIN', `${amount(0)} behind`, `${amount(s.shove)} total`, true);
        view.action = `You bet ${amount(s.bet)} → Villain shoves to ${amount(s.shove)}`;
        view.question = 'What equity do you need to call?';
        view.note = 'Heads-up · Chip maths · Ignore rake and tournament payouts'; break;
      case 'bluff':
        view.hero.bet = amount(s.bet); view.villain = player('VILLAIN');
        view.action = `You bluff ${amount(s.bet)}`;
        view.question = 'How often must everyone fold to break even?';
        view.note = 'You always lose when called · No later betting · Ignore rake and payouts'; break;
      case 'drawOne': case 'drawTwo':
        view.facts = true; view.hero = null; view.potLabel = 'Clean outs'; view.pot = fmt(s.outs);
        view.potNote = q.skill === 'drawTwo' ? 'Flop · All-in · Both cards guaranteed' : 'One card to come';
        view.blind = ''; view.action = `Use the rule of ${s.multiplier}`;
        view.question = 'Approximately what percentage chance of hitting?';
        view.note = 'A draw estimate, not exact winning equity'; break;
      default: return null;
    }
    const rounding = q.unit === '%' ? 'Nearest whole percentage point' : ['BB', 'SPR'].includes(q.unit) ? 'Round to 0.1' : q.unit === '£' ? 'Nearest penny' : 'Nearest chip';
    view.rounding = rounding;
    return view;
  },
};
