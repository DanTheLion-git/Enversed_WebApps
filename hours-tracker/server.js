'use strict';

const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'enversed-dev-secret-change-in-production';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Auth routes ────────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  return res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json(user);
});

// ── Clients ────────────────────────────────────────────────────────────────────

app.get('/api/clients', requireAuth, (req, res) => {
  const db = getDb();
  const clients = db.prepare('SELECT * FROM clients WHERE active = 1 ORDER BY name').all();
  return res.json(clients);
});

// ── Time entries ───────────────────────────────────────────────────────────────

app.get('/api/entries', requireAuth, (req, res) => {
  const { month } = req.query; // YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month query param required (YYYY-MM)' });
  }

  const db = getDb();
  const entries = db.prepare(`
    SELECT te.*, c.name as client_name, c.code as client_code, c.color as client_color
    FROM time_entries te
    JOIN clients c ON c.id = te.client_id
    WHERE te.user_id = ? AND te.date LIKE ?
    ORDER BY te.date, c.name
  `).all([req.user.id, `${month}-%`]);

  return res.json(entries);
});

app.post('/api/entries', requireAuth, (req, res) => {
  const { client_id, date, dates, hours, notes = '' } = req.body || {};

  if (!client_id || !hours) {
    return res.status(400).json({ error: 'client_id and hours are required' });
  }

  const db = getDb();
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND active = 1').get(client_id);
  if (!client) return res.status(400).json({ error: 'Invalid client' });

  if (hours < 0.5 || hours > 8 || (hours * 2) % 1 !== 0) {
    return res.status(400).json({ error: 'Hours must be between 0.5 and 8 in 0.5 increments' });
  }

  const targetDates = dates ? dates : (date ? [date] : null);
  if (!targetDates || targetDates.length === 0) {
    return res.status(400).json({ error: 'date or dates required' });
  }

  const upsert = db.prepare(`
    INSERT INTO time_entries (user_id, client_id, date, hours, notes)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, client_id, date) DO UPDATE SET hours = excluded.hours, notes = excluded.notes
  `);

  const select = db.prepare(`
    SELECT te.*, c.name as client_name, c.code as client_code, c.color as client_color
    FROM time_entries te
    JOIN clients c ON c.id = te.client_id
    WHERE te.user_id = ? AND te.client_id = ? AND te.date = ?
  `);

  const results = [];
  db.exec('BEGIN');
  try {
    for (const d of targetDates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      upsert.run([req.user.id, client_id, d, hours, notes]);
      results.push(select.get([req.user.id, client_id, d]));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return res.status(201).json(results);
});

app.put('/api/entries/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { client_id, hours, notes } = req.body || {};

  if (!client_id || !hours) {
    return res.status(400).json({ error: 'client_id and hours are required' });
  }

  if (hours < 0.5 || hours > 8 || (hours * 2) % 1 !== 0) {
    return res.status(400).json({ error: 'Hours must be between 0.5 and 8 in 0.5 increments' });
  }

  const db = getDb();
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  if (entry.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND active = 1').get(client_id);
  if (!client) return res.status(400).json({ error: 'Invalid client' });

  db.prepare(`
    UPDATE time_entries SET client_id = ?, hours = ?, notes = ? WHERE id = ?
  `).run([client_id, hours, notes ?? '', id]);

  const updated = db.prepare(`
    SELECT te.*, c.name as client_name, c.code as client_code, c.color as client_color
    FROM time_entries te
    JOIN clients c ON c.id = te.client_id
    WHERE te.id = ?
  `).get(id);

  return res.json(updated);
});

app.delete('/api/entries/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  if (entry.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

  db.prepare('DELETE FROM time_entries WHERE id = ?').run(id);
  return res.status(204).send();
});

// ── Start ──────────────────────────────────────────────────────────────────────

// Initialize DB on startup
getDb();

app.listen(PORT, () => {
  console.log(`Enversed Hours Tracker running on http://localhost:${PORT}`);
});
