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

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pto_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      type TEXT NOT NULL,
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // New tables
  _db.exec(`
    CREATE TABLE IF NOT EXISTS store_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      store_name TEXT NOT NULL,
      login_url TEXT NOT NULL,
      username TEXT DEFAULT '',
      password TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      client_id INTEGER REFERENCES clients(id),
      url TEXT NOT NULL,
      store_domain TEXT DEFAULT '',
      store_name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      estimated_cost REAL,
      actual_cost REAL,
      status TEXT DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      purchased_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrations for clients table
  try { _db.exec("ALTER TABLE clients ADD COLUMN max_hours REAL"); } catch(e) {}
  try { _db.exec("ALTER TABLE clients ADD COLUMN deadline TEXT"); } catch(e) {}
  try { _db.exec("ALTER TABLE clients ADD COLUMN description TEXT DEFAULT ''"); } catch(e) {}
  try { _db.exec("ALTER TABLE clients ADD COLUMN purchase_budget REAL"); } catch(e) {}

  // Migration: make purchase_requests.client_id nullable (was incorrectly NOT NULL)
  try {
    const cols = _db.prepare("PRAGMA table_info(purchase_requests)").all();
    const col = cols.find(c => c.name === 'client_id');
    if (col && col.notnull === 1) {
      _db.exec("PRAGMA foreign_keys = OFF");
      _db.exec(`
        CREATE TABLE purchase_requests_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id),
          client_id INTEGER REFERENCES clients(id),
          url TEXT NOT NULL,
          store_domain TEXT DEFAULT '',
          store_name TEXT DEFAULT '',
          description TEXT DEFAULT '',
          estimated_cost REAL,
          actual_cost REAL,
          status TEXT DEFAULT 'pending',
          reviewed_by INTEGER REFERENCES users(id),
          reviewed_at TEXT,
          purchased_at TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
      _db.exec("INSERT INTO purchase_requests_v2 SELECT * FROM purchase_requests");
      _db.exec("DROP TABLE purchase_requests");
      _db.exec("ALTER TABLE purchase_requests_v2 RENAME TO purchase_requests");
      _db.exec("PRAGMA foreign_keys = ON");
    }
  } catch(e) {}

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

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  function firstOfMonth(addMonths) {
    const d = new Date(year, month + addMonths, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }

  const insertClient = db.prepare(
    'INSERT INTO clients (name, code, color, max_hours, deadline, description) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const clients = [
    { name: 'TU/e',               code: 'TUE', color: '#0066cc', max_hours: 320,  deadline: firstOfMonth(3), description: 'Eindhoven University of Technology research collaboration' },
    { name: 'Philips',            code: 'PHI', color: '#00a0e3', max_hours: 160,  deadline: firstOfMonth(2), description: 'Philips digital health platform development' },
    { name: 'NS',                 code: 'NS',  color: '#f9b000', max_hours: 480,  deadline: firstOfMonth(5), description: 'Nederlandse Spoorwegen passenger experience project' },
    { name: 'Red Bull',           code: 'RB',  color: '#cc1e2c', max_hours: 80,   deadline: firstOfMonth(1), description: 'Red Bull Racing data visualisation' },
    { name: 'Politie Nederland',  code: 'POL', color: '#154273', max_hours: null, deadline: null,            description: 'Dutch National Police IT modernisation' },
    { name: 'Sioux Technologies', code: 'SIX', color: '#e8501a', max_hours: null, deadline: null,            description: 'Embedded systems consultancy' },
    { name: 'Bavaria',            code: 'BAV', color: '#e2a62a', max_hours: null, deadline: null,            description: 'Bavaria brewery brand & digital strategy' },
    { name: 'Enversed Internal',  code: 'INT', color: '#448fff', max_hours: null, deadline: null,            description: 'Internal tooling and company projects' },
  ];

  const clientIds = clients.map(c => {
    const info = insertClient.run([c.name, c.code, c.color, c.max_hours, c.deadline, c.description]);
    return info.lastInsertRowid;
  });

  const insertEntry = db.prepare(
    'INSERT OR IGNORE INTO time_entries (user_id, client_id, date, hours, notes) VALUES (?, ?, ?, ?, ?)'
  );

  function dateStr(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const entrySets = [
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

  db.exec('BEGIN');
  try {
    for (const { userId, entries } of entrySets) {
      for (const { day, clientIdx, hours } of entries) {
        if (day <= daysInMonth) {
          insertEntry.run([userId, clientIds[clientIdx], dateStr(day), hours, '']);
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Seed expenses (only if none exist)
  const expCount = db.prepare('SELECT COUNT(*) as c FROM expenses').get().c;
  if (expCount === 0) {
    function dStr(day) { return dateStr(Math.min(day, daysInMonth)); }
    const insertExp = db.prepare(
      'INSERT INTO expenses (user_id, date, amount, category, description, status, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const danielId = userIds[0];
    const emmaId   = userIds[1];
    const thomasId = userIds[2];
    const sophieId = userIds[3];

    const expenses = [
      [danielId, dStr(2),  85.00,  'Travel',        'Train Amsterdam – Eindhoven (TU/e sprint)',        'approved', danielId, "datetime('now','-5 days')"],
      [danielId, dStr(9),  210.00, 'Accommodation', 'Hotel Eindhoven 2 nights',                         'approved', danielId, "datetime('now','-4 days')"],
      [emmaId,   dStr(3),  45.50,  'Food',          'Client lunch with NS team',                        'approved', danielId, "datetime('now','-3 days')"],
      [emmaId,   dStr(7),  130.00, 'Equipment',     'USB-C hub for remote work',                        'pending',  null,     null],
      [emmaId,   dStr(10), 22.80,  'Travel',        'Taxi to Philips HQ',                               'pending',  null,     null],
      [thomasId, dStr(4),  350.00, 'Equipment',     'Mechanical keyboard for home office',              'pending',  null,     null],
      [thomasId, dStr(8),  67.40,  'Travel',        'Train Rotterdam – Eindhoven return',               'approved', danielId, "datetime('now','-2 days')"],
      [sophieId, dStr(1),  95.00,  'Travel',        'Flight Amsterdam – Brussels (Red Bull event)',     'approved', danielId, "datetime('now','-6 days')"],
      [sophieId, dStr(6),  18.50,  'Food',          'Working lunch – Enversed office',                  'pending',  null,     null],
      [sophieId, dStr(11), 275.00, 'Accommodation', 'Airbnb Rotterdam (NS on-site week)',               'pending',  null,     null],
    ];

    db.exec('BEGIN');
    try {
      for (const [uid, date, amount, category, description, status, reviewedBy, reviewedAt] of expenses) {
        if (reviewedAt) {
          db.prepare(
            `INSERT INTO expenses (user_id, date, amount, category, description, status, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ${reviewedAt})`
          ).run([uid, date, amount, category, description, status, reviewedBy]);
        } else {
          insertExp.run([uid, date, amount, category, description, status, null, null]);
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // Seed PTO requests (only if none exist)
  const ptoCount = db.prepare('SELECT COUNT(*) as c FROM pto_requests').get().c;
  if (ptoCount === 0) {
    const insertPto = db.prepare(
      'INSERT INTO pto_requests (user_id, start_date, end_date, type, notes, status, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );

    // Next week Monday (approx)
    const nextMon = new Date(year, month, now.getDate() + (8 - now.getDay()) % 7 || 7);
    function fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
    const nextMonStr = fmtDate(nextMon);
    const nextWedStr = fmtDate(new Date(nextMon.getFullYear(), nextMon.getMonth(), nextMon.getDate() + 2));

    // Yesterday
    const yesterday = new Date(year, month, now.getDate() - 1);
    const yesterdayStr = fmtDate(yesterday);

    // Last week Mon–Fri
    const lastMonday = new Date(year, month, now.getDate() - now.getDay() - 6);
    const lastFriday = new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate() + 4);
    const lastMonStr = fmtDate(lastMonday);
    const lastFriStr = fmtDate(lastFriday);

    const danielId = userIds[0];
    const emmaId   = userIds[1];
    const thomasId = userIds[2];
    const sophieId = userIds[3];

    db.exec('BEGIN');
    try {
      // Emma: 3 vacation days next week — pending
      insertPto.run([emmaId, nextMonStr, nextWedStr, 'Vacation', 'Family trip to Paris', 'pending', null, null]);
      // Thomas: 1 sick day yesterday — pending
      insertPto.run([thomasId, yesterdayStr, yesterdayStr, 'Sick', 'Feeling unwell, staying home', 'pending', null, null]);
      // Sophie: vacation last week — approved by Daniel
      db.prepare(
        `INSERT INTO pto_requests (user_id, start_date, end_date, type, notes, status, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','-7 days'))`
      ).run([sophieId, lastMonStr, lastFriStr, 'Vacation', 'Annual leave – hiking trip', 'approved', danielId]);
      // Daniel: personal day — approved
      const personalDay = fmtDate(new Date(year, month, Math.max(1, now.getDate() - 10)));
      db.prepare(
        `INSERT INTO pto_requests (user_id, start_date, end_date, type, notes, status, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','-10 days'))`
      ).run([danielId, personalDay, personalDay, 'Personal', 'Moving house', 'approved', danielId]);
      // Emma: rejected sick day from earlier
      const earlierDay = fmtDate(new Date(year, month, Math.max(1, now.getDate() - 15)));
      db.prepare(
        `INSERT INTO pto_requests (user_id, start_date, end_date, type, notes, status, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','-14 days'))`
      ).run([emmaId, earlierDay, earlierDay, 'Sick', '', 'rejected', danielId]);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // Seed store credentials (pre-populate known asset stores without passwords)
  const storeCount = db.prepare('SELECT COUNT(*) as c FROM store_credentials').get().c;
  if (storeCount === 0) {
    const insertStore = db.prepare(
      'INSERT INTO store_credentials (domain, store_name, login_url, username, password, notes) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const stores = [
      ['assetstore.unity.com',  'Unity Asset Store',       'https://id.unity.com/en/conversations/login',        '', '', ''],
      ['fab.com',               'Fab (Epic/Unreal)',        'https://www.fab.com/sign-in',                        '', '', 'Formerly Unreal Marketplace + Quixel + ArtStation Marketplace'],
      ['turbosquid.com',        'TurboSquid',              'https://www.turbosquid.com/Login',                   '', '', ''],
      ['cgtrader.com',          'CGTrader',                'https://www.cgtrader.com/users/sign_in',              '', '', ''],
      ['elements.envato.com',   'Envato Elements',         'https://elements.envato.com/sign-in',                '', '', 'Also covers ThemeForest, CodeCanyon, AudioJungle'],
      ['codecanyon.net',        'CodeCanyon (Envato)',     'https://elements.envato.com/sign-in',                '', '', 'Use Envato login'],
      ['themeforest.net',       'ThemeForest (Envato)',    'https://elements.envato.com/sign-in',                '', '', 'Use Envato login'],
      ['stock.adobe.com',       'Adobe Stock',             'https://auth.services.adobe.com/en_US/index.html',   '', '', ''],
      ['shutterstock.com',      'Shutterstock',            'https://www.shutterstock.com/login',                 '', '', ''],
      ['sketchfab.com',         'Sketchfab Store',         'https://sketchfab.com/login',                        '', '', ''],
      ['artstation.com',        'ArtStation Marketplace',  'https://www.artstation.com/users/sign_in',            '', '', ''],
      ['gamedevmarket.net',     'GameDev Market',          'https://www.gamedevmarket.net/sign-in',              '', '', ''],
      ['itch.io',               'Itch.io',                 'https://itch.io/login',                              '', '', ''],
      ['kenney.nl',             'Kenney Assets',           'https://kenney.nl/account',                          '', '', ''],
    ];
    db.exec('BEGIN');
    try {
      for (const row of stores) insertStore.run(row);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  // Seed purchase requests (only if none exist)
  const prCount = db.prepare('SELECT COUNT(*) as c FROM purchase_requests').get().c;
  if (prCount === 0) {
    const danielId = userIds[0];
    const emmaId   = userIds[1];
    const thomasId = userIds[2];
    const sophieId = userIds[3];

    const reqs = [
      // Pending
      [emmaId,   clientIds[0], 'https://assetstore.unity.com/packages/3d/characters/humanoids/fantasy/polygon-fantasy-rivals-236861', 'assetstore.unity.com', 'Unity Asset Store', 'Need polygon characters for TU/e VR prototype', 54.99, null, 'pending'],
      [thomasId, clientIds[2], 'https://fab.com/listings/abc123-environment-pack', 'fab.com', 'Fab (Epic/Unreal)', 'Outdoor environment pack for NS station simulation', 89.99, null, 'pending'],
      [sophieId, clientIds[1], 'https://www.shutterstock.com/image-photo/corporate-meeting-office-12345', 'shutterstock.com', 'Shutterstock', 'Stock photo for Philips presentation deck', 29.00, null, 'pending'],
      // Approved (waiting to be purchased)
      [danielId, clientIds[7], 'https://elements.envato.com/data-visualization-dashboard-UI-kit-XYZABC', 'elements.envato.com', 'Envato Elements', 'Dashboard UI kit for internal tools project', 16.50, null, 'approved'],
      // Purchased (completed, budget deducted)
      [emmaId,   clientIds[0], 'https://turbosquid.com/3d-models/university-building-3d-1234567', 'turbosquid.com', 'TurboSquid', 'University building model for TU/e campus VR', 49.00, 49.00, 'purchased'],
      [thomasId, clientIds[3], 'https://assetstore.unity.com/packages/audio/sound-fx/redbull-sfx-pack-99999', 'assetstore.unity.com', 'Unity Asset Store', 'Sound FX pack for Red Bull activation', 35.00, 35.00, 'purchased'],
    ];

    db.exec('BEGIN');
    try {
      for (const [uid, cid, url, sd, sn, desc, est, act, status] of reqs) {
        const isPurchased = status === 'purchased';
        const isApproved  = status === 'approved';
        if (isPurchased) {
          db.prepare(
            `INSERT INTO purchase_requests (user_id, client_id, url, store_domain, store_name, description, estimated_cost, actual_cost, status, reviewed_by, reviewed_at, purchased_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','-3 days'), datetime('now','-2 days'))`
          ).run([uid, cid, url, sd, sn, desc, est, act, status, danielId]);
        } else if (isApproved) {
          db.prepare(
            `INSERT INTO purchase_requests (user_id, client_id, url, store_domain, store_name, description, estimated_cost, actual_cost, status, reviewed_by, reviewed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','-1 days'))`
          ).run([uid, cid, url, sd, sn, desc, est, act, status, danielId]);
        } else {
          db.prepare(
            `INSERT INTO purchase_requests (user_id, client_id, url, store_domain, store_name, description, estimated_cost, actual_cost, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run([uid, cid, url, sd, sn, desc, est, act, status]);
        }
      }
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }
}

module.exports = { getDb };
