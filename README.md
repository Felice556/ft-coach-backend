# FT Coach — Backend

[![Tests](https://github.com/Felice556/ft-coach-backend/actions/workflows/test.yml/badge.svg)](https://github.com/Felice556/ft-coach-backend/actions/workflows/test.yml)

REST API for **FT Coach**, a mobile-first web app for personal trainers and their clients: training plans, set-by-set workout logging, progress history and body composition.

I'm a personal trainer and a junior developer: I built FT Coach for my own coaching work, and it's used by my real clients.

🔗 **[Live app](https://ft-coach.pages.dev)** · **[Frontend repo (with screenshots)](https://github.com/Felice556/ft-coach-frontend)**

![FT Coach screenshots](https://raw.githubusercontent.com/Felice556/ft-coach-frontend/main/docs/screenshots/hero.webp)

---

## 🛠️ Tech stack

| | |
|---|---|
| **Runtime** | Node.js, TypeScript |
| **Framework** | Express 5 |
| **Database** | PostgreSQL (Supabase, EU region) |
| **ORM** | Prisma 7 with the `pg` driver adapter, versioned migrations |
| **Validation** | Zod |
| **Auth** | JWT + bcrypt |
| **Security** | Helmet, express-rate-limit, CORS allow-list |
| **Hosting** | Render |

## 🗂️ Data model

```
User (TRAINER | CLIENTE)
 ├── Scheda (training plan, per client)          ── archived, never lost
 │    └── Esercizio (sets, rep range, rest, notes, video)
 │         ├── SerieExtra (extra sets with their own reps/rest, e.g. drop sets)
 │         └── RegistroAllenamento (every set logged: weight, reps, note, date)
 ├── SessioneAllenamento (completed workouts: sets done, volume)
 ├── MisuraCorporea (body weight / body-fat %, one per type per day)
 ├── Invito (single-use sign-up codes)
 └── EsercizioPreset / NotaPreset (trainer's reusable libraries)
```

## 🔒 Security

Security was a priority, because the app stores personal and health data:

- **Invite-only sign-up**: clients register with a single-use, expiring code (`XXXX-XXXX`, generated with `crypto.randomInt`, no ambiguous characters). The code is consumed **atomically** inside a transaction, so it can't be used twice even with simultaneous requests.
- **Revocable sessions**: every token carries a version number checked against the database, so changing or resetting a password **logs out every device**. The role is always read from the database, never trusted from the token.
- **Sessions that renew themselves**: active users receive a fresh token (via a response header) at most every 12 hours, so they never have to log in again, while inactive sessions still expire after 30 days.
- **Temporary passwords**: when the trainer resets a client's password, the client must choose a new one before doing anything else. The trainer never sees the final password.
- **Brute-force protection**: failed logins are limited per IP + email and per email (successful logins don't count, so clients on the same gym Wi-Fi don't block each other), plus limits on sign-up and password change.
- **No user enumeration**: a dummy bcrypt comparison runs for unknown emails, so response times don't reveal which accounts exist; secret codes are compared with `timingSafeEqual`.
- **Data isolation**: a client can only read and write their own data. Every route checks ownership and role, not just authentication.
- **Input validation**: Zod schemas with realistic limits (e.g. body weight 20–350 kg, no future dates, only `http(s)` video links), 100 KB request size limit.
- **HTTP hardening**: Helmet headers, CORS restricted to the frontend domains, `trust proxy` set correctly for rate limiting behind Render's proxy.
- **Data is never deleted by mistake**: plans and exercises are archived; a plan can only be deleted permanently if it is archived *and* has no logged history.

## 📡 API overview

| Area | Endpoints |
|---|---|
| **Auth** | `POST /register` · `POST /login` · `GET /registrazione/info` · `PUT /me/password` |
| **Clients** (trainer) | `GET /clienti` · `PUT /clienti/:id/email` · `PUT /clienti/:id/password` |
| **Plans** | `GET/POST /schede` · `PUT /schede/:id` · `POST /schede/:id/archivia` · `POST /schede/:id/ripristina` · `DELETE /schede/:id` · `GET /schede/:id/storico` · `GET /schede/:id/esercizi-archiviati` |
| **Exercises** | `PUT/DELETE /esercizi/:id` · `POST /esercizi/:id/ripristina` |
| **Workout log** | `POST /registro` · `GET /registro/:esercizioId` · `PUT/DELETE /registro/serie/:id` |
| **Completed workouts** | `GET/POST /sessioni` |
| **Body composition** | `GET /misure` · `PUT /misure` · `DELETE /misure/:id` |
| **Invites** (trainer) | `GET/POST /inviti` · `POST /inviti/:id/annulla` |
| **Libraries** (trainer) | `GET/POST /preset-esercizi` · `DELETE /preset-esercizi/:id` · `GET/POST /preset-note` · `DELETE /preset-note/:id` |
| **Health check** | `GET /health` |

*(Route names are in Italian, like the app.)*

## ✅ Tests

**66 automated tests** (Vitest + Supertest) run against a real PostgreSQL database, on every push, with **GitHub Actions**.
They call the real API routes and check the behaviour that matters most:

| File | What it checks |
|---|---|
| `tests/auth.test.ts` | login and sign-up, forged or expired tokens, role taken from the database, password reset that logs out every device, temporary passwords, self-renewing sessions |
| `tests/inviti-e-limiti.test.ts` | single-use invites (including two people using the same code at the same instant), expired/cancelled codes, invite-only mode, brute-force limits, no user enumeration |
| `tests/schede.test.ts` | plans, set logging, completed workouts, **data isolation between clients**, archiving instead of deleting (no logged set is ever lost), trainer history, input validation, security headers |
| `tests/misure.test.ts` | body weight and body-fat %: who can write what, who can see what, impossible values |

**Safety first:** the tests wipe their database on every run, so they **refuse to start** unless the database is on `localhost` and has `test` in its name. The real database can't be touched by mistake.

Run them locally:

```bash
# 1. once: create an empty PostgreSQL database called ftcoach_test
# 2. if your local user/password isn't postgres/postgres, put the address in .env.test:
#    TEST_DATABASE_URL="postgresql://user:password@localhost:5432/ftcoach_test"
npm run test:db   # create the tables (again after every new migration)
npm test          # run all the tests
```

## 🚀 Run it locally

You need Node.js 22+ and a PostgreSQL database.

```bash
git clone https://github.com/Felice556/ft-coach-backend.git
cd ft-coach-backend
npm install
```

Create a `.env` file:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/ftcoach"
JWT_SECRET="a-long-random-string"
CODICE_TRAINER="a-long-secret-code"   # only needed to register the trainer account, then remove it
FRONTEND_URL="http://localhost:5173"  # comma-separated list of allowed origins
INVITI_OBBLIGATORI=1                  # optional: clients can sign up only with an invite
```

Then:

```bash
npx prisma migrate deploy   # create the tables
npm run dev                 # http://localhost:3001
```

| Script | |
|---|---|
| `npm run dev` | development server with auto-reload |
| `npm run build` | generate the Prisma client and compile TypeScript |
| `npm start` | run the compiled server |
| `npm run db:deploy` | apply pending migrations |
| `npm test` | run the automated tests |
| `npm run test:db` | prepare the test database |

---

## 📄 License

Code shared for portfolio purposes. **© 2026 Felice Russo — All rights reserved**: not licensed for reuse. See [LICENSE](LICENSE).

---

Made by **Felice Russo** · [LinkedIn](https://www.linkedin.com/in/felice-russo-web1/)
