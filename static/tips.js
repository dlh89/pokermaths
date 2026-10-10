// Mental routes from the scenario, also usable for questions saved before this update.
globalThis.PokerTips = {
  build(q) {
    const s = q.scenario;
    if (!s) return '';
    const fmt = n => Number(n).toLocaleString('en-GB', { maximumFractionDigits: 4 });
    const inBB = ['allInOdds', 'shortAllInOdds'].includes(q.skill) && q.difficulty % 2 === 1;
    if (inBB && !s.blind) return '';
    const amount = n => inBB ? `${fmt(n / s.blind)} BB` : q.game === 'cash' ? `£${fmt(n)}` : `${fmt(n)} chips`;
    function divide(n, d) {
      const originalN = n, originalD = d;
      while (Number.isInteger(n) && Number.isInteger(d) && n % 10 === 0 && d % 10 === 0) { n /= 10; d /= 10; }
      const cancel = d !== originalD ? `Cancel matching zeros: ${fmt(originalN)} ÷ ${fmt(originalD)} becomes ${fmt(n)} ÷ ${fmt(d)}. ` : '';
      const whole = Math.floor(n / d), remainder = n - whole * d;
      return `${cancel}${fmt(whole)} × ${fmt(d)} = ${fmt(whole * d)}${remainder > 0.000001 ? `, leaving ${fmt(remainder)}. Add ${fmt(remainder)} ÷ ${fmt(d)} ≈ ${fmt(Math.round(remainder / d * 100) / 100)}` : ', so the division is exact'}.`;
    }
    function percentSize(p, percent) {
      const routes = {
        20: 'Divide by 5, or find 10% and double it.',
        25: 'Halve twice to get a quarter.',
        50: 'Halve the pot.',
        75: 'Find a quarter, then subtract it from the pot.',
        100: 'Use the whole pot.',
        125: 'Add a quarter to the whole pot.',
        150: 'Add half to the whole pot.',
        200: 'Double the pot.',
      };
      // 33% and 67% are close to thirds, but are not exactly 1/3 and 2/3.
      if (percent === 33 || percent === 67) return `A ${percent === 33 ? 'third' : 'two-thirds'} is a quick estimate. For exactly ${percent}%, use ${percent === 33 ? '30% + 3%' : '60% + 7%'}: 10% is ${amount(p / 10)} and 1% is ${amount(p / 100)}. Multiply those pieces by ${Math.floor(percent / 10)} and ${percent % 10}, then add.`;
      if (routes[percent]) return `${routes[percent]} ${fmt(percent)}% of ${amount(p)} = ${amount(p * percent / 100)} before rounding.`;
      const tens = Math.floor(percent / 10), ones = percent % 10;
      return `Build ${fmt(percent)}% from ${tens * 10}%${ones ? ` + ${ones}%` : ''}. 10% is ${amount(p / 10)}${ones ? `; 1% is ${amount(p / 100)}` : ''}. ${tens} × ${amount(p / 10)}${ones ? ` + ${ones} × ${amount(p / 100)}` : ''} = ${amount(p * percent / 100)} before rounding.`;
    }
    function percentage(n, d) {
      const anchor = Math.round(n / d * 20) * 5;
      const anchorAmount = d * anchor / 100, difference = n - anchorAmount;
      return `Use a nearby 5% anchor: ${anchor}% of ${amount(d)} is ${amount(anchorAmount)}. Each 1 percentage point is ${amount(d / 100)}.${Math.abs(difference) > 0.000001 ? ` The numerator is ${amount(Math.abs(difference))} ${difference > 0 ? 'higher' : 'lower'}, so ${difference > 0 ? 'add' : 'subtract'} about ${fmt(Math.abs(difference) / (d / 100))} percentage points.` : ' The numerator matches exactly.'} Round only at the end.`;
    }
    switch (q.skill) {
      case 'trackPot': return 'Carry one total forward at the end of each street. Heads-up bet and call: add twice the bet. With two callers: add three times the bet. For a raise, count each player’s total on that street; do not count an earlier bet twice. Checks and folds add no new chips; previous contributions stay in the pot. Return any uncalled part before adding the street total.';
      case 'chipsToBB': return divide(s.stack, s.blind);
      case 'effectiveStack': return `Use only the smaller stack (${amount(Math.min(s.hero, s.villain))}). ${divide(Math.min(s.hero, s.villain), s.blind)}`;
      case 'spr': return `Count whole pots in the effective stack, then the fraction left over. ${divide(s.effective, s.pot)}`;
      case 'bbToChips': {
        const whole = Math.floor(s.size), fraction = s.size - whole;
        return `Split ${fmt(s.size)} BB into ${whole}${fraction ? ` + ${fmt(fraction)}` : ''}. ${whole} × ${amount(s.blind)} = ${amount(whole * s.blind)}${fraction ? `; ${fmt(fraction)} × ${amount(s.blind)} = ${amount(fraction * s.blind)}. Add the two amounts` : ''}. For halves, halve one big blind; for tenths, divide it by 10.`;
      }
      case 'betSize': return percentSize(s.pot, s.percent);
      case 'betPercent': return `Find 10% of the original pot first: ${amount(s.pot / 10)}. Count how many of those fit in the bet, then multiply that count by 10. ${percentage(s.bet, s.pot)}`;
      case 'potAfterCall': return `Double the bet first (${amount(s.bet)} × 2 = ${amount(2 * s.bet)}), then add the original pot (${amount(s.pot)}). Include both villain's bet and your call.`;
      case 'potOdds': return `Recognise common bet sizes: quarter-pot → about 17%, half-pot → 25%, pot-sized → about 33%. For this example, double the bet and add the original pot to get ${amount(s.pot + 2 * s.bet)}. ${percentage(s.bet, s.pot + 2 * s.bet)}`;
      case 'allInOdds': case 'shortAllInOdds': {
        const matched = Math.min(s.shove, s.heroTotal), call = matched - s.bet, finalPot = s.pot + 2 * matched;
        return `Treat the shove as a total, not an extra raise. ${matched < s.shove ? `Cap both players at your available total (${amount(matched)}); excess chips are returned. ` : ''}Subtract your existing bet: ${amount(matched)} − ${amount(s.bet)} = ${amount(call)} to call. Double the matched total, then add the original pot: ${amount(finalPot)}. ${percentage(call, finalPot)}`;
      }
      case 'bluff': return `Common bluff sizes: half-pot needs about 33% folds; pot-sized needs 50%. Add your bet to the original pot once: ${amount(s.pot + s.bet)}. ${percentage(s.bet, s.pot + s.bet)}`;
      case 'drawOne': return `Double the outs: ${s.outs} + ${s.outs} ≈ ${2 * s.outs}%. This estimates hitting with one card to come, not your exact winning equity.`;
      case 'drawTwo': return `Double twice: ${s.outs} → ${2 * s.outs} → about ${4 * s.outs}%. Only use this when both cards are guaranteed. With many outs it overestimates the hit chance; compare the exact figure above.`;
      default: return '';
    }
  },
};
