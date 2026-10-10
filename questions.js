import { randomBytes } from 'node:crypto';
import { selectSkills, makeQuestion, DIFFICULTIES } from './engine.js';

const badRequest = message => Object.assign(new Error(message), { status: 400 });

export function parsePractice(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw badRequest('Invalid practice selection.');
  const { mode = 'daily', skill = 'all', previous = '', retryOnly = false, game = 'both' } = options;
  if (!['daily', 'free'].includes(mode)) throw badRequest('Unknown practice selection.');
  let selectedSkills;
  try { selectedSkills = selectSkills(skill, options.skills); } catch (error) { throw badRequest(error.message); }
  if (typeof retryOnly !== 'boolean') throw badRequest('Invalid round selection.');
  if (!['both', 'cash', 'tournament'].includes(game)) throw badRequest('Unknown game format.');
  return { mode, previous, retryOnly, selectedSkills, game };
}

export function nextQuestion(db, { mode, previous, retryOnly, selectedSkills, game }, time) {
  const bands = db.prepare('SELECT * FROM bands').all().filter(b => selectedSkills.includes(b.skill));
  // Derive retries from durable review history so refreshes and new devices keep them.
  const latestReview = db.prepare(`SELECT r.rowid AS sequence,r.rating,
    (SELECT count(*) FROM (SELECT rowid FROM reviews newer WHERE newer.rowid > r.rowid LIMIT 2)) AS since
    FROM reviews r JOIN questions q ON q.id=r.question_id
    WHERE q.skill=? AND q.level=? ORDER BY r.rowid DESC LIMIT 1`);
  const missed = bands.flatMap(b => {
    const last = latestReview.get(b.skill, b.level);
    return last?.rating === 'missed' ? [{ ...b, sequence: last.sequence, since: last.since }] : [];
  });
  const isMissed = b => missed.some(m => m.skill === b.skill && m.level === b.level);
  const normal = retryOnly ? [] : bands.filter(b => !isMissed(b) && (mode === 'free' || b.due <= time));
  const readyRetries = missed.filter(b => b.since >= 2 || b.due <= time || !normal.length);
  // Prefer a retry after two intervening answers. With no other work, retry immediately.
  let candidates = readyRetries.length ? readyRetries.sort((a, b) => a.sequence - b.sequence) : normal;
  if (!candidates.length) return { done: true, nextDue: Math.min(...bands.map(b => b.due)) };
  if (!readyRetries.length) {
    const others = candidates.filter(b => b.skill !== previous);
    if (others.length) candidates = others;
    candidates.sort((a, b) => (mode === 'daily' ? a.due - b.due : a.attempts - b.attempts) || a.attempts - b.attempts);
  }
  const selected = candidates[0];
  const retry = isMissed(selected);
  const highest = Math.max(...bands.filter(b => b.skill === selected.skill).map(b => b.level));
  const established = selected.level * 2 + selected.stage;
  let difficulty = established;
  if (retry) {
    const missedQuestion = db.prepare(`SELECT q.payload FROM reviews r JOIN questions q ON q.id=r.question_id WHERE q.skill=? AND q.level=? ORDER BY r.rowid DESC LIMIT 1`).get(selected.skill, selected.level);
    difficulty = JSON.parse(missedQuestion.payload).difficulty ?? established;
  } else if (selected.support) difficulty = Math.max(0, established - 1);
  else if (selected.level === highest && established < 5 && selected.comfortable_days >= 2) {
    const trials = db.prepare(`SELECT r.rating FROM reviews r JOIN questions q ON q.id=r.question_id WHERE q.skill=? AND r.difficulty=? AND r.first_attempt=1 ORDER BY r.rowid DESC LIMIT 4`).all(selected.skill, established + 1);
    const frequency = trials.filter(r => r.rating === 'comfortable').length >= 2 ? 2 : 4;
    if (selected.attempts % frequency === frequency - 1) difficulty++;
  }
  // Keep easier material in the mix after establishing a more demanding step.
  if (!retry && !selected.support && difficulty === established && established > 0 && selected.attempts % 10 === 8) difficulty--;
  const last = db.prepare('SELECT payload FROM questions WHERE skill=? ORDER BY rowid DESC LIMIT 1').get(selected.skill);
  let q;
  for (let i = 0; i < 10; i++) { q = makeQuestion(selected.skill, Math.floor(difficulty / 2), Math.random, difficulty, game); if (!last || JSON.parse(last.payload).prompt !== q.prompt) break; }
  Object.assign(q, { level: selected.level, difficulty, difficultyLabel: DIFFICULTIES[difficulty], version: 2,
    retry, challenge: difficulty > established, support: difficulty < established });
  q.id = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO questions VALUES (?,?,?,?,?)').run(q.id, q.skill, q.level, JSON.stringify(q), time);
  return q;
}
