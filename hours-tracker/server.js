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

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
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
  const clients = db.prepare('SELECT id, name, code, color, active, max_hours, deadline FROM clients WHERE active = 1 ORDER BY name').all();
  return res.json(clients);
});

// ── Admin: Client management ───────────────────────────────────────────────────

app.get('/api/admin/clients', requireAdmin, (req, res) => {
  const db = getDb();
  const clients = db.prepare(`
    SELECT c.*, COALESCE(SUM(te.hours), 0) as total_hours_logged
    FROM clients c
    LEFT JOIN time_entries te ON te.client_id = c.id
    GROUP BY c.id
    ORDER BY c.name
  `).all();
  return res.json(clients);
});

app.post('/api/admin/clients', requireAdmin, (req, res) => {
  const { name, code, color, max_hours, deadline, description } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const db = getDb();
  const info = db.prepare(
    'INSERT INTO clients (name, code, color, max_hours, deadline, description) VALUES (?, ?, ?, ?, ?, ?)'
  ).run([name, code || '', color || '#448fff', max_hours || null, deadline || null, description || '']);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
  return res.status(201).json(client);
});

app.put('/api/admin/clients/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });

  const { name, code, color, max_hours, deadline, description, active } = req.body || {};
  db.prepare(`
    UPDATE clients SET
      name = COALESCE(?, name),
      code = COALESCE(?, code),
      color = COALESCE(?, color),
      max_hours = ?,
      deadline = ?,
      description = COALESCE(?, description),
      active = COALESCE(?, active)
    WHERE id = ?
  `).run([
    name || null, code || null, color || null,
    max_hours !== undefined ? max_hours : existing.max_hours,
    deadline !== undefined ? deadline : existing.deadline,
    description !== undefined ? description : null,
    active !== undefined ? (active ? 1 : 0) : null,
    id
  ]);
  const updated = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  return res.json(updated);
});

app.delete('/api/admin/clients/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.prepare('SELECT id FROM clients WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Client not found' });
  db.prepare('UPDATE clients SET active = 0 WHERE id = ?').run(id);
  return res.status(204).send();
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

// ── Expenses ───────────────────────────────────────────────────────────────────

app.get('/api/expenses', requireAuth, (req, res) => {
  const db = getDb();
  const { month } = req.query;
  let sql = 'SELECT * FROM expenses WHERE user_id = ?';
  const params = [req.user.id];
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    sql += ' AND date LIKE ?';
    params.push(`${month}-%`);
  }
  sql += ' ORDER BY date DESC, id DESC';
  return res.json(db.prepare(sql).all(params));
});

app.post('/api/expenses', requireAuth, (req, res) => {
  const { date, amount, category, description } = req.body || {};
  if (!date || !amount || !category || !description) {
    return res.status(400).json({ error: 'date, amount, category, description required' });
  }
  const validCategories = ['Travel', 'Accommodation', 'Equipment', 'Food', 'Other'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  if (amount <= 0) return res.status(400).json({ error: 'Amount must be positive' });
  const db = getDb();
  const info = db.prepare(
    'INSERT INTO expenses (user_id, date, amount, category, description) VALUES (?, ?, ?, ?, ?)'
  ).run([req.user.id, date, amount, category, description]);
  return res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/expenses/:id', requireAuth, (req, res) => {
  const db = getDb();
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!expense) return res.status(404).json({ error: 'Not found' });
  if (expense.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (expense.status !== 'pending') return res.status(400).json({ error: 'Only pending expenses can be deleted' });
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  return res.status(204).send();
});

// Admin expense routes
app.get('/api/admin/expenses/export', requireAdmin, (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month query param required (YYYY-MM)' });
  }
  const db = getDb();
  const rows = db.prepare(`
    SELECT e.date, u.name as employee, e.category, e.description, e.amount, e.status
    FROM expenses e
    JOIN users u ON u.id = e.user_id
    WHERE e.date LIKE ?
    ORDER BY e.date, u.name
  `).all([`${month}-%`]);

  const lines = ['Date,Employee,Category,Description,Amount(EUR),Status'];
  for (const r of rows) {
    const desc = `"${r.description.replace(/"/g, '""')}"`;
    lines.push(`${r.date},${r.employee},${r.category},${desc},${r.amount.toFixed(2)},${r.status}`);
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="expenses-${month}.csv"`);
  return res.send(lines.join('\n'));
});

app.get('/api/admin/expenses', requireAdmin, (req, res) => {
  const { month } = req.query;
  const db = getDb();
  let sql = `
    SELECT e.*, u.name as user_name
    FROM expenses e
    JOIN users u ON u.id = e.user_id
  `;
  const params = [];
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    sql += ' WHERE e.date LIKE ?';
    params.push(`${month}-%`);
  }
  sql += ' ORDER BY e.date DESC, e.id DESC';
  return res.json(db.prepare(sql).all(params));
});

app.put('/api/admin/expenses/:id', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved or rejected' });
  }
  const db = getDb();
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!expense) return res.status(404).json({ error: 'Not found' });
  db.prepare(`
    UPDATE expenses SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?
  `).run([status, req.user.id, req.params.id]);
  return res.json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id));
});

// ── PTO requests ───────────────────────────────────────────────────────────────

app.get('/api/pto', requireAuth, (req, res) => {
  const db = getDb();
  return res.json(db.prepare(
    'SELECT * FROM pto_requests WHERE user_id = ? ORDER BY created_at DESC'
  ).all([req.user.id]));
});

app.post('/api/pto', requireAuth, (req, res) => {
  const { start_date, end_date, type, notes = '' } = req.body || {};
  if (!start_date || !end_date || !type) {
    return res.status(400).json({ error: 'start_date, end_date, type required' });
  }
  if (start_date > end_date) return res.status(400).json({ error: 'start_date must be <= end_date' });
  const validTypes = ['Vacation', 'Sick', 'Personal'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const db = getDb();
  const info = db.prepare(
    'INSERT INTO pto_requests (user_id, start_date, end_date, type, notes) VALUES (?, ?, ?, ?, ?)'
  ).run([req.user.id, start_date, end_date, type, notes]);
  return res.status(201).json(db.prepare('SELECT * FROM pto_requests WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/pto/:id', requireAuth, (req, res) => {
  const db = getDb();
  const pto = db.prepare('SELECT * FROM pto_requests WHERE id = ?').get(req.params.id);
  if (!pto) return res.status(404).json({ error: 'Not found' });
  if (pto.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  if (pto.status !== 'pending') return res.status(400).json({ error: 'Only pending requests can be deleted' });
  db.prepare('DELETE FROM pto_requests WHERE id = ?').run(req.params.id);
  return res.status(204).send();
});

app.get('/api/admin/pto', requireAdmin, (req, res) => {
  const { status } = req.query;
  const db = getDb();
  let sql = `
    SELECT p.*, u.name as user_name
    FROM pto_requests p
    JOIN users u ON u.id = p.user_id
  `;
  const params = [];
  if (status) { sql += ' WHERE p.status = ?'; params.push(status); }
  sql += ' ORDER BY p.created_at DESC';
  return res.json(db.prepare(sql).all(params));
});

app.put('/api/admin/pto/:id', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved or rejected' });
  }
  const db = getDb();
  const pto = db.prepare('SELECT * FROM pto_requests WHERE id = ?').get(req.params.id);
  if (!pto) return res.status(404).json({ error: 'Not found' });
  db.prepare(`
    UPDATE pto_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?
  `).run([status, req.user.id, req.params.id]);
  return res.json(db.prepare('SELECT * FROM pto_requests WHERE id = ?').get(req.params.id));
});

// ── Admin reports ──────────────────────────────────────────────────────────────

app.get('/api/admin/reports/hours', requireAdmin, (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month query param required (YYYY-MM)' });
  }
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      u.id as user_id, u.name as user_name,
      c.id as client_id, c.name as client_name, c.color as client_color,
      c.max_hours, c.deadline,
      SUM(te.hours) as hours
    FROM time_entries te
    JOIN users u ON u.id = te.user_id
    JOIN clients c ON c.id = te.client_id
    WHERE te.date LIKE ?
    GROUP BY u.id, c.id
    ORDER BY u.name, c.name
  `).all([`${month}-%`]);

  // by_employee
  const empMap = {};
  for (const r of rows) {
    if (!empMap[r.user_id]) empMap[r.user_id] = { user_id: r.user_id, name: r.user_name, total_hours: 0, by_client: [] };
    empMap[r.user_id].by_client.push({ client_id: r.client_id, client_name: r.client_name, hours: r.hours });
    empMap[r.user_id].total_hours += r.hours;
  }

  // by_client — include all clients with max_hours/deadline
  const clientRows = db.prepare(`
    SELECT c.id as client_id, c.name as client_name, c.color, c.max_hours, c.deadline,
      COALESCE(SUM(CASE WHEN te.date LIKE ? THEN te.hours ELSE 0 END), 0) as total_logged,
      u.id as user_id, u.name as user_name,
      SUM(CASE WHEN te.date LIKE ? THEN te.hours ELSE 0 END) as emp_hours
    FROM clients c
    LEFT JOIN time_entries te ON te.client_id = c.id
    LEFT JOIN users u ON u.id = te.user_id
    WHERE c.active = 1
    GROUP BY c.id, u.id
    ORDER BY c.name, u.name
  `).all([`${month}-%`, `${month}-%`]);

  const clientMap = {};
  for (const r of clientRows) {
    if (!clientMap[r.client_id]) {
      clientMap[r.client_id] = {
        client_id: r.client_id, client_name: r.client_name, color: r.color,
        max_hours: r.max_hours, deadline: r.deadline,
        total_logged: 0, budget_pct: null, by_employee: []
      };
    }
    if (r.user_id && r.emp_hours > 0) {
      clientMap[r.client_id].total_logged += r.emp_hours;
      clientMap[r.client_id].by_employee.push({ user_id: r.user_id, user_name: r.user_name, hours: r.emp_hours });
    }
  }
  for (const c of Object.values(clientMap)) {
    if (c.max_hours) c.budget_pct = Math.round((c.total_logged / c.max_hours) * 100);
  }

  return res.json({
    month,
    by_employee: Object.values(empMap),
    by_client: Object.values(clientMap),
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────

getDb();

app.listen(PORT, () => {
  console.log(`Enversed Hours Tracker running on http://localhost:${PORT}`);
});
