const $ = id => document.getElementById(id);
// A decimal point has no following space, so it stays inside its number.
const explanationLines = text => String(text || '').replace(/([.;])[ \t]+/g, '$1\n');
const storageKey = 'little-by-little-poker-v1';
let local, storageAvailable = true, busy = false, state, authenticated = false;
try { local = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { storageAvailable = false; }
local = local && typeof local === 'object' ? local : {};
local.pending = Array.isArray(local.pending) ? local.pending : [];
local.count = Number.isInteger(local.count) ? local.count : 0;
local.mode = ['daily', 'free'].includes(local.mode) ? local.mode : 'daily';
local.skill ||= 'all';
local.game = ['both', 'cash', 'tournament'].includes(local.game) ? local.game : 'both';
// A restored question has an unknown start time. Never count time away from the
// page, explanation reading, or network latency as calculation time.
let timingId = local.question?.id, startedAt = null;
let displayedQuestionId;
const onPhone = () => window.matchMedia?.('(max-width: 600px)').matches === true;
// Mobile keyboards and zoom can shrink the visible viewport without changing
// the layout viewport used by position:fixed. Keep the controls above its edge.
function positionAnswerControls() {
  const viewport = window.visualViewport;
  const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
  $('workspace').style.setProperty('--controls-bottom', `${inset}px`);
}
window.visualViewport?.addEventListener('resize', positionAnswerControls);
window.visualViewport?.addEventListener('scroll', positionAnswerControls);
window.addEventListener('resize', positionAnswerControls);
positionAnswerControls();
function interruptTiming() { startedAt = null; }
document.addEventListener?.('visibilitychange', () => { if (document.hidden) interruptTiming(); });
window.addEventListener('blur', interruptTiming);

function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify(local)); storageAvailable = true; return true; }
  catch { storageAvailable = false; return false; }
}
function status(message, warning = false, retry = false) {
  $('connection').textContent = message;
  $('connection').classList.toggle('warning', warning);
  if (retry) { const b = document.createElement('button'); b.textContent = 'Retry'; b.onclick = () => run(resume); $('connection').append(b); }
}
function savedStatus(extra = '') {
  status(storageAvailable ? (extra || 'Progress saved to your server') : 'Server saving is available, but this browser cannot keep a local recovery copy.', !storageAvailable);
}
async function api(route, body) {
  const response = await fetch(`/api/${route}`, { method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Maths-Request': '1' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Request failed.'); error.status = response.status; throw error; }
  return data;
}
function showLogin() {
  authenticated = false;
  $('login').hidden = false; $('workspace').hidden = true; $('logout').hidden = true;
  status(local.pending.length ? 'An answer is waiting on this device. Sign in to save it.' : 'Your practice, saved between visits.');
}
async function run(action) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button,select,input').forEach(e => { e.disabled = true; });
  try { await action(); }
  catch (error) {
    if (error.status === 401) { showLogin(); $('login-error').textContent = error.message; }
    else status(local.pending.length ? `Answer not saved to the server yet. ${storageAvailable ? 'A recovery copy is on this device.' : 'Keep this page open to avoid losing it.'} ${error.message}` : `Could not connect. ${error.message}`, true, true);
  } finally {
    busy = false;
    document.querySelectorAll('button,select,input').forEach(e => { e.disabled = false; });
    if (local.wrong) document.querySelectorAll('[data-rating]:not([data-rating="missed"])').forEach(e => { e.disabled = true; });
    if (local.tracking?.id === local.question?.id && local.tracking?.assisted) document.querySelectorAll('[data-rating="comfortable"]').forEach(e => { e.disabled = true; });
    if (local.pending.length) document.querySelectorAll('[data-rating],#mode,#skill,#game,#typed,#reveal,#edit-skills,#custom-picker button,#custom-picker input').forEach(e => { e.disabled = true; });
  }
}
async function flush(advance = false) {
  let unlocked = false, missed = false;
  let next;
  while (local.pending.length) {
    const withNext = advance && local.pending.length === 1;
    const result = await api(withNext ? 'review-next' : 'review', {
      ...local.pending[0],
      ...(withNext ? { practice: {
        mode: local.mode, game: local.game, skills: selectedSkills(), previous: local.question?.skill || local.previous,
        retryOnly: local.count + 1 >= 10,
      } } : {}),
    });
    missed ||= local.pending[0].rating === 'missed';
    unlocked ||= result.unlocked;
    local.pending.shift();
    local.count += 1;
    local.previous = local.question?.skill;
    next = result.next;
    local.question = next && !next.done ? next : null;
    local.revealed = false; local.wrong = false; local.entry = ''; local.measurement = null;
    persist();
  }
  savedStatus(missed ? 'Saved — this skill will return until you get it right.' : unlocked ? 'A new difficulty is unlocked for tomorrow. Progress saved.' : '');
  return next;
}
async function refresh() {
  state = await api('state');
  if (!$('skill').dataset.loaded) {
    for (const s of state.skills) $('skill').add(new Option(s.name, s.id));
    $('skill').dataset.loaded = 'true';
  }
  if (![...$('skill').options].some(o => o.value === local.skill)) local.skill = 'all';
  local.customSkills = Array.isArray(local.customSkills) ? local.customSkills.filter(id => state.skills.some(s => s.id === id)) : [];
  if (local.skill === 'custom' && !local.customSkills.length) local.skill = 'all';
  $('skill').querySelector('[value="custom"]').textContent = local.skill === 'custom' ? `Custom mix (${local.customSkills.length})` : 'Choose a custom mix…';
  $('edit-skills').hidden = local.skill !== 'custom';
  $('game').value = local.game; $('skill').value = local.skill; $('mode').value = local.mode; $('typed').checked = Boolean(local.typed);
  if (local.question && !local.pending.length && !state.skills.some(s => s.id === local.question.skill)) {
    local.question = null; local.revealed = false; local.wrong = false; local.entry = ''; local.measurement = null; persist();
  }
  renderProgress();
}
function selectedSkills() {
  if (local.skill === 'custom') return local.customSkills;
  return state.skills.filter(s => local.skill === 'all' || s.category === local.skill || s.id === local.skill).map(s => s.id);
}
function openSkillPicker() {
  const selected = new Set(selectedSkills());
  $('skill-checkboxes').replaceChildren();
  for (const [category, name] of [['stacks', 'Stacks & big blinds'], ['sizing', 'Bet sizing & pots'], ['odds', 'Pot odds & bluffs']]) {
    const group = document.createElement('fieldset'), legend = document.createElement('legend');
    legend.textContent = name; group.append(legend);
    for (const s of state.skills.filter(s => s.category === category)) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = s.id; input.checked = selected.has(s.id);
      label.append(input, document.createTextNode(s.name)); group.append(label);
    }
    $('skill-checkboxes').append(group);
  }
  $('selection-error').textContent = '';
  $('custom-picker').hidden = false;
}
function renderQuestion() {
  const q = local.question;
  $('question-card').hidden = !q; $('finish').hidden = Boolean(q);
  $('counter').textContent = local.count >= 10 && q ? `${local.count} done · Retry` : `${local.count} / 10`;
  $('progress-bar').style.width = `${Math.min(local.count, 10) * 10}%`;
  $('session-label').textContent = local.mode === 'daily' ? 'DAILY PRACTICE' : 'FREE PRACTICE';
  if (!q) return;
  if (timingId !== q.id) {
    timingId = q.id;
    startedAt = document.hidden || (document.hasFocus && !document.hasFocus()) ? null : Date.now();
    local.measurement = null;
  }
  const tracking = q.skill === 'trackPot';
  if (tracking && local.tracking?.id !== q.id) { local.tracking = { id: q.id, index: 0, assisted: false }; persist(); }
  const ready = !tracking || local.tracking.index > q.scenario.streets.length;
  const table = globalThis.PokerTable?.build(q, tracking ? local.tracking.index : 0);
  renderTable(table, q);
  $('question').textContent = table?.question || q.prompt;
  $('context-label').textContent = q.contextLabel || 'Poker practice';
  $('answer-unit').textContent = q.unit ? `Answer in ${q.unit === '£' ? 'pounds' : q.unit}. ${table ? `${table.rounding}. ` : ''}${q.unit === '%' ? 'Within 1 percentage point is accepted.' : ''}` : '';
  $('level-label').textContent = q.difficultyLabel || state.levels[q.level];
  $('question-caption').textContent = q.retry ? 'Try another from this skill' : q.challenge ? 'Try a slightly harder example' : local.typed ? 'Work it out, then enter your answer' : 'Work it out in your head';
  $('answer-form').hidden = Boolean(local.revealed);
  $('answer-input').hidden = !local.typed || !ready;
  $('answer-input').value = local.entry || '';
  $('reveal').textContent = !ready ? (local.tracking.index === 0 ? 'Show flop action' : local.tracking.index === q.scenario.streets.length ? 'Finish hand' : 'Next street') : local.typed ? 'Check answer' : 'Show answer';
  $('replay-action').hidden = !tracking || local.tracking.index === 0;
  $('text-scenario').hidden = tracking && !local.revealed || !table;
  $('answer-panel').hidden = !local.revealed;
  // Format from the numeric answer, including questions restored from storage
  // whose older answerLabel may have no thousands separators.
  const displayAnswer = Number(q.answer).toLocaleString('en-GB', { maximumFractionDigits: 4 });
  $('answer').textContent = q.unit === '£' ? `£${displayAnswer}` : `${displayAnswer}${q.unit === '%' ? '%' : q.unit ? ` ${q.unit}` : ''}`;
  $('method').textContent = q.method; $('steps').textContent = explanationLines(q.steps);
  const mentalTip = globalThis.PokerTips?.build(q) || '';
  $('mental-tip').textContent = explanationLines(mentalTip);
  $('mental-tip-panel').hidden = !mentalTip;
  $('correctness').textContent = local.typed ? (local.wrong ? `Your answer: ${local.entry} · Not quite` : 'Correct') : 'ANSWER';
  if (tracking && local.tracking.assisted) $('correctness').textContent += ' · Used replay (not independent recall)';
  if (local.revealed) document.querySelectorAll('[data-rating]').forEach(e => { e.disabled = local.wrong && e.dataset.rating !== 'missed' || tracking && local.tracking.assisted && e.dataset.rating === 'comfortable'; });
  if (displayedQuestionId !== q.id && onPhone()) $('question-card').scrollIntoView({ block: 'start', behavior: 'instant' });
  displayedQuestionId = q.id;
}
function renderTable(view, q) {
  $('table-view').hidden = !view; $('table-title').hidden = !view; $('text-scenario').hidden = !view;
  if (!view) return;
  $('table-title').textContent = q.label || 'Poker practice';
  $('raise-target').hidden = !view.raiseTarget;
  $('raise-target-size').textContent = view.raiseTarget || '';
  $('streets-remaining').hidden = !view.streetsRemaining;
  $('streets-remaining-count').textContent = view.streetsRemaining || '';
  $('streets-remaining-names').textContent = view.streetNames || '';
  $('scenario-description').textContent = q.prompt;
  $('table-blind').textContent = view.blind; $('table-blind').hidden = !view.blind;
  $('poker-table').classList.toggle('draw-facts', view.facts);
  $('poker-table').classList.toggle('multiway', Boolean(view.third));
  const seat = (side, player) => {
    $(`${side}-seat`).hidden = !player;
    $(`${side}-bet`).hidden = !player?.bet;
    if (!player) return;
    $(`${side}-name`).textContent = player.name;
    $(`${side}-stack`).textContent = player.stack;
    $(`${side}-bet-amount`).textContent = side === 'hero' && player.bet ? `${q.skill === 'potAfterCall' ? 'Your call' : 'Your bet'}: ${player.bet}` : player.bet;
  };
  seat('hero', view.hero); seat('villain', view.villain); seat('third', view.third);
  $('villain-allin').hidden = !view.villain?.allIn;
  $('table-pot').hidden = !view.pot;
  $('pot-label').textContent = view.potLabel; $('pot-amount').textContent = view.pot; $('pot-note').textContent = view.potNote;
  $('table-action').textContent = explanationLines(view.action); $('table-action').hidden = !view.action;
  $('table-note').textContent = view.note; $('table-note').hidden = !view.note;
}
function finish(nextDue) {
  local.question = null; local.revealed = false; persist(); renderQuestion();
  $('level-label').textContent = '';
  $('finish-title').textContent = local.count >= 10 ? 'A little further along.' : 'You’re up to date.';
  const when = nextDue ? new Date(nextDue).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }) : null;
  $('finish-text').textContent = `${local.count ? `${local.count} question${local.count === 1 ? '' : 's'} practised. ` : ''}${when ? `Next review: ${when}. You can still practise whenever you like.` : 'Your progress is saved. Stop here, or do another short round.'}`;
  if (onPhone()) $('finish').scrollIntoView({ block: 'start', behavior: 'instant' });
}
async function nextQuestion(preloaded) {
  if (preloaded?.done) return finish(preloaded.nextDue);
  if (!local.question) {
    const q = await api('question', { mode: local.mode, game: local.game, skills: selectedSkills(), previous: local.previous, retryOnly: local.count >= 10 });
    if (q.done) return finish(q.nextDue);
    local.question = q; local.revealed = false; local.wrong = false; local.entry = ''; persist();
  }
  renderQuestion();
}
async function resume() {
  await refresh(); authenticated = true;
  $('login').hidden = true; $('workspace').hidden = false; $('logout').hidden = false;
  await flush(); await refresh();
  const today = Math.floor(state.now / 86400000);
  if (local.sessionDay !== today) {
    local.count = 0; local.sessionDay = today; persist();
  }
  await nextQuestion();
}
function renderProgress() {
  $('progress-summary').textContent = `${state.total} answers saved · ${state.due} skill level${state.due === 1 ? '' : 's'} due for review`;
  $('skill-list').replaceChildren();
  for (const skill of state.skills) {
    const bands = state.bands.filter(b => b.skill === skill.id), highest = Math.max(...bands.map(b => b.level));
    const next = Math.min(...bands.map(b => b.due)), due = next <= state.now;
    const row = document.createElement('div'); row.className = 'skill-row';
    const top = document.createElement('div'); top.className = 'skill-top';
    const name = document.createElement('strong'); name.textContent = skill.name;
    const label = document.createElement('span'); label.textContent = due ? 'Due now' : `Next: ${new Date(next).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
    top.append(name, label);
    const established = highest * 2 + (bands.find(b => b.level === highest).stage || 0);
    const track = document.createElement('div'); track.className = 'bands'; track.setAttribute('aria-hidden', 'true');
    for (let step = 0; step < 6; step++) { const b = document.createElement('span'); b.className = `band${step <= established ? ' unlocked' : ''}`; track.append(b); }
    const text = document.createElement('p');
    text.textContent = `Step ${established + 1} of 6 · ${state.difficulties?.[established] || state.levels[highest]} · ${established < 5 ? 'Harder examples introduced gradually; first attempts across days guide progression.' : 'All steps reached; keep practising for retention.'}`;
    row.append(top, track, text);
    const measurements = (state.measurements || []).filter(m => m.skill === skill.id);
    for (const m of measurements) {
      const detail = document.createElement('p'), r = m.recent, p = m.previous;
      const accuracy = stats => `${Math.round(stats.correct / stats.attempts * 100)}%`;
      detail.textContent = `${state.difficulties[m.difficulty]} · ${m.mode === 'typed' ? 'Typed' : m.mode === 'mental' ? 'Self-marked' : 'Unspecified mode'}: ${r.correct}/${r.attempts} first attempts correct (${accuracy(r)})${r.medianMs == null ? '' : ` · ${Math.round(r.medianMs / 100) / 10}s median on correct answers`}${p.attempts >= 5 && r.attempts >= 5 ? ` · Previous ${p.attempts}: ${accuracy(p)}${p.medianMs == null ? '' : `, ${Math.round(p.medianMs / 100) / 10}s`}` : ''}`;
      row.append(detail);
    }
    if (!measurements.length) { const note = document.createElement('p'); note.textContent = 'New first-attempt measurements will appear as you practise. Existing history is preserved.'; row.append(note); }
    $('skill-list').append(row);
  }
}
$('login-form').addEventListener('submit', e => { e.preventDefault(); run(async () => { $('login-error').textContent = ''; await api('login', { username: $('username').value, password: $('password').value }); $('password').value = ''; await resume(); }); });
$('logout').onclick = () => run(async () => { await flush(); await api('logout', {}); showLogin(); });
$('answer-form').addEventListener('submit', e => {
  e.preventDefault(); if (busy || !local.question || local.pending.length || local.revealed) return;
  if (local.question.skill === 'trackPot' && local.tracking.index <= local.question.scenario.streets.length) {
    local.tracking.index++; persist(); renderQuestion(); return;
  }
  if (local.typed) {
    const raw = $('answer-input').value.trim().replace(',', '.');
    if (!/^\d+(?:\.\d+)?$/.test(raw)) { $('answer-input').setCustomValidity('Enter a number, such as 16 or 16.4.'); $('answer-input').reportValidity(); return; }
    local.entry = raw;
    local.wrong = Math.abs(Number(raw) - Number(local.question.answer)) > (local.question.tolerance ?? 0.000001) + 1e-8;
  }
  const elapsed = startedAt == null ? null : Date.now() - startedAt;
  local.measurement = { elapsedMs: elapsed != null && elapsed >= 0 && elapsed <= 600000 ? elapsed : null, answerMode: local.typed ? 'typed' : 'mental' };
  if (local.question.skill === 'trackPot') local.measurement.assisted = local.tracking.assisted;
  startedAt = null;
  local.revealed = true; persist(); renderQuestion();
  $('answer-input').blur?.();
  $('answer-panel').scrollIntoView({ block: onPhone() ? 'start' : 'nearest', behavior: 'instant' });
});
$('replay-action').onclick = () => {
  if (busy || local.revealed || local.pending.length || local.question?.skill !== 'trackPot') return;
  local.tracking.index = 0; local.tracking.assisted = true; interruptTiming(); persist(); renderQuestion();
};
$('answer-input').oninput = () => $('answer-input').setCustomValidity('');
document.querySelectorAll('[data-rating]').forEach(b => { b.onclick = () => run(async () => {
  if (!local.question || !local.revealed || local.pending.length) return;
  local.pending.push({ id: local.question.id, rating: local.wrong ? 'missed' : b.dataset.rating, ...local.measurement });
  persist(); status('Saving your answer…');
  const next = await flush(true);
  await nextQuestion(next);
}); });
async function changePractice(id, value) {
  await flush(); local[id] = value; local.count = 0; local.question = null; local.wrong = false;
  $('custom-picker').hidden = true; persist(); await refresh(); await nextQuestion();
}
$('game').onchange = () => { const value = $('game').value; run(() => changePractice('game', value)); };
$('mode').onchange = () => { const value = $('mode').value; run(() => changePractice('mode', value)); };
$('skill').onchange = () => {
  const value = $('skill').value;
  if (value === 'custom') { openSkillPicker(); return; }
  run(() => changePractice('skill', value));
};
$('apply-skills').onclick = () => {
  const ids = [...$('skill-checkboxes').querySelectorAll('input:checked')].map(input => input.value);
  if (!ids.length) { $('selection-error').textContent = 'Choose at least one skill.'; return; }
  run(async () => { await flush(); local.customSkills = ids; await changePractice('skill', 'custom'); });
};
$('cancel-skills').onclick = () => { $('custom-picker').hidden = true; $('skill').value = local.skill; };
$('edit-skills').onclick = openSkillPicker;
$('typed').onchange = () => { if (local.revealed) { $('typed').checked = Boolean(local.typed); return; } interruptTiming(); local.typed = $('typed').checked; local.wrong = false; local.entry = ''; persist(); renderQuestion(); };
$('continue').onclick = () => run(async () => { local.mode = 'free'; local.count = 0; local.question = null; local.wrong = false; persist(); $('mode').value = 'free'; await nextQuestion(); });
function showView(progress) {
  if (progress) interruptTiming();
  $('practice-view').hidden = progress; $('progress-view').hidden = !progress;
  $('practice-tab').toggleAttribute('aria-current', !progress); $('progress-tab').toggleAttribute('aria-current', progress);
}
$('practice-tab').onclick = () => showView(false);
$('progress-tab').onclick = () => run(async () => { await refresh(); showView(true); });
window.addEventListener('online', () => { if (authenticated) run(resume); });
window.addEventListener('offline', () => status('Connection lost. Your current answer can be kept on this device until you reconnect.', true));
// Optional agent support uses the same visible state; never submits ratings on a user's behalf.
if (document.modelContext?.registerTool) {
  try { Promise.resolve(document.modelContext.registerTool({ name: 'read_practice_progress', description: 'Read the signed-in poker maths progress currently shown by the app.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async input => {
    if (input && Object.keys(input).length) throw new Error('No arguments expected.');
    if (!authenticated) throw new Error('Sign in first.');
    await refresh(); return { total: state.total, due: state.due, bands: state.bands };
  } })).catch(() => {}); } catch { /* Unsupported browsers continue normally. */ }
}
run(resume);
