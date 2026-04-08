'use strict';

const path = require('path');
const Database = require('node-sqlite3-wasm').Database;
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'hours.db');

let _db = null;

function getDb() {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.exec("PRAGMA foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'employee',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT,
      color TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      client_id INTEGER NOT NULL REFERENCES clients(id),
      date TEXT NOT NULL,
      hours REAL NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, client_id, date)
    );
  `);

  const userCount = _db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount === 0) {
    seed(_db);
  }

  return _db;
}

function seed(db) {
  const password = 'Enversed123!';
  const hash = bcrypt.hashSync(password, 10);

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  );

  const users = [
    { name: 'Daniel van Leeuwen', email: 'daniel@enversed.com', role: 'admin' },
    { name: 'Emma de Vries',      email: 'emma@enversed.com',   role: 'employee' },
    { name: 'Thomas Bakker',      email: 'thomas@enversed.com', role: 'employee' },
    { name: 'Sophie van den Berg',email: 'sophie@enversed.com', role: 'employee' },
  ];

  const userIds = users.map(u => {
    const info = insertUser.run([u.name, u.email, hash, u.role]);
    return info.lastInsertRowid;
  });

  const insertClient = db.prepare(
    'INSERT INTO clients (name, code, color) VALUES (?, ?, ?)'
  );

  const clients = [
    { name: 'TU/e',               code: 'TUE', color: '#0066cc' },
    { name: 'Philips',            code: 'PHI', color: '#00a0e3' },
    { name: 'NS',                 code: 'NS',  color: '#f9b000' },
    { name: 'Red Bull',           code: 'RB',  color: '#cc1e2c' },
    { name: 'Politie Nederland',  code: 'POL', color: '#154273' },
    { name: 'Sioux Technologies', code: 'SIX', color: '#e8501a' },
    { name: 'Bavaria',            code: 'BAV', color: '#e2a62a' },
    { name: 'Enversed Internal',  code: 'INT', color: '#448fff' },
  ];

  const clientIds = clients.map(c => {
    const info = insertClient.run([c.name, c.code, c.color]);
    return info.lastInsertRowid;
  });

  const insertEntry = db.prepare(
    'INSERT OR IGNORE INTO time_entries (user_id, client_id, date, hours, notes) VALUES (?, ?, ?, ?, ?)'
  );

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  function dateStr(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Determine days in current month
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Seed entries: skip weekends, spread across 4 users, ~10 entries each
  const entrySets = [
    // Daniel (admin) — days 1..15
    { userId: userIds[0], entries: [
      { day: 1,  clientIdx: 0, hours: 8 },
      { day: 2,  clientIdx: 1, hours: 6 },
      { day: 3,  clientIdx: 7, hours: 2 },
      { day: 6,  clientIdx: 2, hours: 8 },
      { day: 7,  clientIdx: 0, hours: 4 },
      { day: 7,  clientIdx: 7, hours: 4 },
      { day: 8,  clientIdx: 3, hours: 8 },
      { day: 9,  clientIdx: 1, hours: 7 },
      { day: 10, clientIdx: 4, hours: 8 },
      { day: 13, clientIdx: 5, hours: 8 },
      { day: 14, clientIdx: 6, hours: 5 },
    ]},
    // Emma — days 1..12
    { userId: userIds[1], entries: [
      { day: 1,  clientIdx: 2, hours: 8 },
      { day: 2,  clientIdx: 2, hours: 8 },
      { day: 3,  clientIdx: 3, hours: 6 },
      { day: 6,  clientIdx: 0, hours: 8 },
      { day: 7,  clientIdx: 0, hours: 8 },
      { day: 8,  clientIdx: 1, hours: 4 },
      { day: 8,  clientIdx: 7, hours: 4 },
      { day: 9,  clientIdx: 5, hours: 8 },
      { day: 10, clientIdx: 6, hours: 7 },
      { day: 13, clientIdx: 4, hours: 8 },
    ]},
    // Thomas — days 3..14
    { userId: userIds[2], entries: [
      { day: 3,  clientIdx: 1, hours: 8 },
      { day: 6,  clientIdx: 3, hours: 8 },
      { day: 7,  clientIdx: 3, hours: 6 },
      { day: 7,  clientIdx: 7, hours: 2 },
      { day: 8,  clientIdx: 0, hours: 8 },
      { day: 9,  clientIdx: 2, hours: 8 },
      { day: 10, clientIdx: 1, hours: 5 },
      { day: 13, clientIdx: 6, hours: 8 },
      { day: 14, clientIdx: 5, hours: 7 },
      { day: 15, clientIdx: 4, hours: 8 },
    ]},
    // Sophie — days 1..13
    { userId: userIds[3], entries: [
      { day: 1,  clientIdx: 4, hours: 8 },
      { day: 2,  clientIdx: 5, hours: 8 },
      { day: 3,  clientIdx: 6, hours: 7 },
      { day: 6,  clientIdx: 7, hours: 4 },
      { day: 6,  clientIdx: 1, hours: 4 },
      { day: 7,  clientIdx: 2, hours: 8 },
      { day: 8,  clientIdx: 4, hours: 6 },
      { day: 9,  clientIdx: 3, hours: 8 },
      { day: 10, clientIdx: 0, hours: 8 },
      { day: 13, clientIdx: 7, hours: 3 },
      { day: 14, clientIdx: 1, hours: 8 },
    ]},
  ];

  const results = [];
  _db.exec('BEGIN');
  try {
    for (const { userId, entries } of entrySets) {
      for (const { day, clientIdx, hours } of entries) {
        if (day <= daysInMonth) {
          insertEntry.run([userId, clientIds[clientIdx], dateStr(day), hours, '']);
        }
      }
    }
    _db.exec('COMMIT');
  } catch (err) {
    _db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { getDb };
