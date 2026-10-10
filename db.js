import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { SKILLS, schedule } from './engine.js';

export function openDatabase(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, 'poker.sqlite3'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS account (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS throttle (id INTEGER PRIMARY KEY CHECK(id=1), failures INTEGER NOT NULL, since INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bands (skill TEXT NOT NULL, level INTEGER NOT NULL,
      step INTEGER NOT NULL DEFAULT -1, due INTEGER NOT NULL DEFAULT 0, last_day INTEGER NOT NULL DEFAULT -1,
      comfortable_days INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(skill,level));
    CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, skill TEXT NOT NULL, level INTEGER NOT NULL, payload TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews (question_id TEXT PRIMARY KEY REFERENCES questions(id), rating TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS questions_skill_level ON questions(skill,level);
    CREATE INDEX IF NOT EXISTS questions_skill ON questions(skill);
    `);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('PRAGMA table_info(account)').all().some(column => column.name === 'username')) {
      db.exec("ALTER TABLE account ADD COLUMN username TEXT NOT NULL DEFAULT 'admin'; DELETE FROM sessions;");
    }
    const add = (table, name, definition) => {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    };
    add('bands', 'stage', 'INTEGER NOT NULL DEFAULT 0');
    add('bands', 'support', 'INTEGER NOT NULL DEFAULT 0');
    add('reviews', 'first_attempt', 'INTEGER');
    add('reviews', 'difficulty', 'INTEGER');
    add('reviews', 'elapsed_ms', 'INTEGER');
    add('reviews', 'answer_mode', 'TEXT');
    db.exec('PRAGMA user_version=3; COMMIT;');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  for (const skill of Object.keys(SKILLS)) db.prepare('INSERT OR IGNORE INTO bands(skill,level) VALUES (?,0)').run(skill);
  return db;
}

export function recordReview(db, id, rating, now, measurement = {}) {
  const elapsed = measurement.elapsedMs;
  if ((elapsed != null && (!Number.isInteger(elapsed) || elapsed < 0 || elapsed > 600_000)) || (measurement.answerMode != null && !['mental', 'typed'].includes(measurement.answerMode))) {
    throw Object.assign(new Error('Invalid answer measurement.'), { status: 400 });
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const q = db.prepare('SELECT * FROM questions WHERE id=?').get(id);
    if (!q) { const error = new Error('Question not found. Your local answer has been kept.'); error.status = 404; throw error; }
    if (db.prepare('SELECT 1 FROM reviews WHERE question_id=?').get(id)) {
      db.exec('COMMIT'); return { ok: true, alreadySaved: true };
    }
    const before = db.prepare('SELECT * FROM bands WHERE skill=? AND level=?').get(q.skill, q.level);
    const payload = JSON.parse(q.payload);
    const last = db.prepare(`SELECT r.rating FROM reviews r JOIN questions q ON q.id=r.question_id WHERE q.skill=? AND q.level=? ORDER BY r.rowid DESC LIMIT 1`).get(q.skill, q.level);
    const retry = payload.retry === true || last?.rating === 'missed';
    const tracked = payload.version === 2;
    const after = schedule(before, rating, now, retry);
    const highest = db.prepare('SELECT max(level) AS level FROM bands WHERE skill=?').get(q.skill).level;
    // Keep developing skills available often enough for gradual trials. Mature
    // steps retain the longer retention intervals; existing due dates migrate untouched.
    if (tracked && q.level === highest && q.level * 2 + before.stage < 5) after.due = Math.min(after.due, now + 7 * 86_400_000);
    db.prepare('UPDATE bands SET step=?,due=?,last_day=?,comfortable_days=?,attempts=? WHERE skill=? AND level=?')
      .run(after.step, after.due, after.last_day, after.comfortable_days, after.attempts, q.skill, q.level);
    db.prepare('INSERT INTO reviews(question_id,rating,at,first_attempt,difficulty,elapsed_ms,answer_mode) VALUES (?,?,?,?,?,?,?)')
      .run(id, rating, now, tracked ? Number(!retry) : null, tracked ? payload.difficulty : null, tracked ? elapsed ?? null : null, tracked ? measurement.answerMode ?? null : null);
    let unlocked = false;
    if (tracked && !retry) {
      const recent = db.prepare(`SELECT r.rating,r.at FROM reviews r JOIN questions q ON q.id=r.question_id
        WHERE q.skill=? AND r.difficulty=? AND r.first_attempt=1 ORDER BY r.rowid DESC LIMIT 8`).all(q.skill, payload.difficulty);
      const comfortable = recent.filter(r => r.rating === 'comfortable');
      const days = new Set(comfortable.map(r => Math.floor(r.at / 86_400_000))).size;
      const current = q.level * 2 + before.stage;
      // Only harder trial questions can promote. Successes on retries or the
      // established step never substitute for independent harder examples.
      if (payload.difficulty === current + 1 && comfortable.length >= 4 && comfortable.length / recent.length >= 0.8 && days >= 3 && rating === 'comfortable') {
        if (before.stage === 0) db.prepare('UPDATE bands SET stage=1,support=0 WHERE skill=? AND level=?').run(q.skill, q.level);
        else unlocked = db.prepare('INSERT OR IGNORE INTO bands(skill,level,due) VALUES (?,?,?)').run(q.skill, q.level + 1, now + 86_400_000).changes > 0;
      }
      if (recent.slice(0, 3).filter(r => r.rating === 'missed').length >= 2) db.prepare('UPDATE bands SET support=1 WHERE skill=? AND level=?').run(q.skill, q.level);
      else if (recent.slice(0, 2).length === 2 && recent.slice(0, 2).every(r => r.rating === 'comfortable')) db.prepare('UPDATE bands SET support=0 WHERE skill=? AND level=?').run(q.skill, q.level);
    }
    db.exec('COMMIT');
    return { ok: true, unlocked, due: after.due };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function progressMeasurements(db) {
  const rows = db.prepare(`SELECT q.skill,r.* FROM reviews r JOIN questions q ON q.id=r.question_id
    WHERE r.first_attempt=1 ORDER BY r.rowid DESC`).all();
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.skill}:${r.difficulty}:${r.answer_mode || 'unknown'}`;
    if (!groups.has(key)) groups.set(key, { skill: r.skill, difficulty: r.difficulty, mode: r.answer_mode, rows: [] });
    if (groups.get(key).rows.length < 40) groups.get(key).rows.push(r);
  }
  const summarize = rows => {
    const times = rows.filter(r => r.rating !== 'missed' && r.elapsed_ms != null).map(r => r.elapsed_ms).sort((a,b) => a-b);
    return { attempts: rows.length, correct: rows.filter(r => r.rating !== 'missed').length,
      medianMs: times.length >= 3 ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : null };
  };
  return [...groups.values()].map(g => ({ skill: g.skill, difficulty: g.difficulty, mode: g.mode,
    recent: summarize(g.rows.slice(0, 20)), previous: summarize(g.rows.slice(20)) }));
}
