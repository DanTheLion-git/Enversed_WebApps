# Enversed Hours Tracker

A mobile-first, single-page hours tracking web application for Enversed Studios. Built with Node.js, Express, SQLite, and a vanilla JS SPA frontend.

---

## Features

- 📅 Monthly calendar view with coloured dots for logged hours
- ⏱ Log hours per client per day (0.5 – 8 h in 0.5 increments)
- 📋 Multi-day selection — log the same hours across several days at once
- 🗑 Edit / delete individual entries
- 🔐 JWT-based auth (30-day tokens, stored in localStorage)
- 📱 Mobile-first PWA feel (iOS safe area, touch targets, no zoom)

---

## Running with Docker (recommended for Raspberry Pi)

```bash
docker-compose up -d
```

App will be available at `http://<host>:3000`.

The SQLite database is persisted in the `hours_data` Docker volume.

---

## Running locally

```bash
npm install
node server.js
```

Or with auto-restart on file changes:

```bash
npm run dev
```

---

## Default login credentials

| Name | Email | Password | Role |
|---|---|---|---|
| Daniel van Leeuwen | daniel@enversed.com | Enversed123! | admin |
| Emma de Vries | emma@enversed.com | Enversed123! | employee |
| Thomas Bakker | thomas@enversed.com | Enversed123! | employee |
| Sophie van den Berg | sophie@enversed.com | Enversed123! | employee |

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | – | Login → returns JWT + user |
| GET | `/api/auth/me` | ✅ | Returns current user info |
| GET | `/api/clients` | ✅ | List all active clients |
| GET | `/api/entries?month=YYYY-MM` | ✅ | Get user's entries for month |
| POST | `/api/entries` | ✅ | Create/upsert entry/entries |
| PUT | `/api/entries/:id` | ✅ | Update own entry |
| DELETE | `/api/entries/:id` | ✅ | Delete own entry |

All authenticated endpoints require `Authorization: Bearer <token>` header.

---

## Changing JWT secret for production

Set the `JWT_SECRET` environment variable before starting:

```bash
JWT_SECRET=your-strong-random-secret node server.js
```

Or update the `environment` section in `docker-compose.yml`:

```yaml
environment:
  - JWT_SECRET=your-strong-random-secret
```

**Never** use the default secret in production.

---

## Database

SQLite database path is controlled by `DATABASE_PATH` env var (default: `./hours.db` locally, `/data/hours.db` in Docker).
