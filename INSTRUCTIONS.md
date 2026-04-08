# Enversed WebApps — Instructions

This repository contains the internal web applications for Enversed Studios.

---

## Projects

| Folder | Description |
|---|---|
| `hours-tracker/` | Mobile-first hours tracking, expense reporting, PTO requests, and purchase requests |

---

## hours-tracker

A single-page Node.js/Express app backed by SQLite. Employees log hours, submit expenses, request PTO, and request asset purchases. Admins manage everything from a separate dashboard.

### Requirements

- [Node.js](https://nodejs.org/) v18 or later (for local development)
- [Docker](https://www.docker.com/) (recommended for the Raspberry Pi / production)

---

### Starting locally

```bash
cd hours-tracker
npm install
npm start
```

For auto-restart on file changes during development:

```bash
npm run dev
```

The app runs on **http://localhost:3000** by default.

> **Note:** If the server refuses to start with a `database is locked` error, a stale lock file was left behind by a previous crash. Delete it and try again:
> ```bash
> rm hours-tracker/hours.db.lock
> ```

---

### Starting with Docker (production / Raspberry Pi)

```bash
cd hours-tracker
docker-compose up -d
```

The app will be available at `http://<host-ip>:3000`.

The SQLite database is persisted in a Docker volume (`hours_data`) so data survives container restarts and rebuilds.

To stop:

```bash
docker-compose down
```

To rebuild after code changes:

```bash
docker-compose up -d --build
```

---

### Default login credentials

These are seeded automatically when the database is empty (first run).

| Name | Email | Password | Role |
|---|---|---|---|
| Daniel van Leeuwen | daniel@enversed.com | Enversed123! | admin |
| Emma de Vries | emma@enversed.com | Enversed123! | employee |
| Thomas Bakker | thomas@enversed.com | Enversed123! | employee |
| Sophie van den Berg | sophie@enversed.com | Enversed123! | employee |

---

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on |
| `JWT_SECRET` | `enversed-dev-secret-change-in-production` | Secret used to sign JWT tokens — **must be changed in production** |
| `DATABASE_PATH` | `./hours.db` (local) / `/data/hours.db` (Docker) | Path to the SQLite database file |

Set them inline or via your shell before starting:

```bash
JWT_SECRET=your-strong-secret DATABASE_PATH=/opt/data/hours.db node server.js
```

Or update the `environment:` block in `docker-compose.yml`.

---

### User-facing features (employee)

Navigate between tabs in the bottom nav bar:

| Tab | What it does |
|---|---|
| **Calendar** | Monthly calendar view. Tap a day (or select multiple days) to log hours for a client. Logged days show a coloured dot. |
| **Expenses** | Submit expense claims (Travel, Accommodation, Equipment, Food, Other). View past submissions and their approval status. |
| **PTO** | Request time off (Vacation, Sick, Personal). View pending/approved/rejected requests. |
| **Purchases** | Request an asset or product purchase by pasting a product URL. Optionally attach to a project and add an estimated cost. |

---

### Admin dashboard (`/admin.html`)

Only accounts with `role = admin` can access this page. It redirects non-admins back to `/`.

| Tab | What it does |
|---|---|
| **Overview** | Month-by-month hours breakdown by employee and by project, with budget/deadline indicators. |
| **Team** | Manage user accounts — create, edit, activate/deactivate employees. |
| **Projects** | Create and edit client projects (name, code, colour, max hours budget, deadline). Soft-delete (deactivate) projects without losing history. |
| **Expenses** | Review all employee expense submissions. Approve or reject individual items. Export a month's expenses as CSV. |
| **PTO** | Review all PTO requests. Approve or reject. |
| **Purchases** | Review purchase requests. Approve, reject, or mark as purchased (with optional actual cost). Manage store credentials for shared team accounts. |

---

### Adding a new user (admin)

1. Open the admin dashboard → **Team** tab.
2. Click **+ Add Employee**.
3. Fill in name, email, a temporary password, and role.
4. The employee can log in immediately.

There is no self-registration — all accounts are created by an admin.

---

### Adding a new project (admin)

1. Open the admin dashboard → **Projects** tab.
2. Click **+ New Project**.
3. Set a name, short code (up to 6 chars), colour, optional hours budget, and optional deadline.
4. The project becomes available immediately for employees to log time against.

---

### Approving purchases (admin)

1. Open the admin dashboard → **Purchases** tab.
2. Pending requests appear at the top (use the filter tabs to switch views).
3. Click **✓ Approve** to approve, or **✗ Reject** to reject.
4. Once approved, click **🛒 Mark Purchased** to record the actual cost when the item has been bought.

Store credentials (shared team logins for e.g. Amazon, Coolblue) can be managed in the **Store Credentials** section below the purchase list. When an employee submits a purchase URL from a known store, the store name is auto-detected.

---

### Database

The app uses a single SQLite file. Schema is created automatically on first start; migrations run on every subsequent start via `getDb()` in `database.js`.

**Tables:**

| Table | Description |
|---|---|
| `users` | Employee accounts |
| `clients` | Projects / clients |
| `time_entries` | Hours logged per user per client per day |
| `expenses` | Expense claims |
| `pto_requests` | Time-off requests |
| `purchase_requests` | Asset/product purchase requests |
| `store_credentials` | Admin-managed shared store login info |

To inspect or edit the database directly, use any SQLite client (e.g. [DB Browser for SQLite](https://sqlitebrowser.org/)) against `hours.db`.

---

### API overview

All endpoints require `Authorization: Bearer <token>` except `/api/auth/login`.

**Auth**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login — returns `{ token, user }` |
| `GET` | `/api/auth/me` | Returns the current user |

**Time entries (employee)**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/entries?month=YYYY-MM` | Get own entries for a month |
| `POST` | `/api/entries` | Create/upsert entries (`date` or `dates[]`, `client_id`, `hours`) |
| `PUT` | `/api/entries/:id` | Update an entry |
| `DELETE` | `/api/entries/:id` | Delete an entry |

**Expenses (employee)**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/expenses?month=YYYY-MM` | Get own expenses |
| `POST` | `/api/expenses` | Submit an expense |
| `DELETE` | `/api/expenses/:id` | Cancel a pending expense |

**PTO (employee)**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/pto` | Get own PTO requests |
| `POST` | `/api/pto` | Submit a PTO request |
| `DELETE` | `/api/pto/:id` | Cancel a pending PTO request |

**Purchases (employee)**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/purchases` | Get own purchase requests |
| `POST` | `/api/purchases` | Submit a purchase request (`url` required; `client_id`, `estimated_cost`, `description` optional) |
| `DELETE` | `/api/purchases/:id` | Cancel a pending purchase request |
| `GET` | `/api/purchases/detect-store?url=...` | Auto-detect store name from a URL |

**Admin — Projects**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/clients` | List all projects with total hours logged |
| `POST` | `/api/admin/clients` | Create a project |
| `PUT` | `/api/admin/clients/:id` | Update a project |
| `DELETE` | `/api/admin/clients/:id` | Deactivate a project |

**Admin — Team**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/users` | List all users |
| `POST` | `/api/admin/users` | Create a user |
| `PUT` | `/api/admin/users/:id` | Update a user |

**Admin — Expenses / PTO / Purchases**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/expenses?month=YYYY-MM` | List all expenses |
| `PUT` | `/api/admin/expenses/:id` | Approve or reject an expense |
| `GET` | `/api/admin/expenses/export?month=YYYY-MM` | Download expenses as CSV |
| `GET` | `/api/admin/pto` | List all PTO requests |
| `PUT` | `/api/admin/pto/:id` | Approve or reject a PTO request |
| `GET` | `/api/admin/purchases` | List all purchase requests |
| `PUT` | `/api/admin/purchases/:id` | Approve, reject, or mark as purchased |
| `GET` | `/api/admin/store-credentials` | List store credentials |
| `POST` | `/api/admin/store-credentials` | Add a store credential |
| `PUT` | `/api/admin/store-credentials/:id` | Update a store credential |
| `DELETE` | `/api/admin/store-credentials/:id` | Delete a store credential |

**Admin — Reports**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/reports/hours?month=YYYY-MM` | Hours breakdown by employee and by project for a given month |
