# Huquq Test Pro — Standalone

Professional law-test platform starter, independent of Hatchable.

## Included
- Separate student and admin areas
- Login with username/password
- Admin-created tests
- Unlimited answer options per question
- Single-answer and multi-answer questions
- Per-question points
- Shuffle questions and options per attempt
- Early test submission with confirmation
- Timer
- Immediate result OR admin approval mode
- Student mistake history
- Retry mistakes
- Per-test leaderboard
- Overall leaderboard
- Admin student management
- CSV import for bulk questions
- PostgreSQL persistence
- Docker Compose for one-command local setup

## Run with Docker

1. Install Docker Desktop.
2. Run:
   `docker compose up --build`
3. Open:
   http://localhost:3000

Demo admin:
- Login: `admin`
- Password: `admin123`

Demo student:
- Login: `student`
- Password: `student123`

Change demo passwords before real use.

## Production
Put the app behind HTTPS and set secure environment variables in `.env`.
For 1000+ active learners, use a managed PostgreSQL database and a Node process manager or container platform with at least 2 app instances.

## Admin panel
Open `http://localhost:3000/admin.html` after starting the server. Login with the demo admin account.

## Final entry flow

Open the root URL. Choose:
- O‘quvchi → login → student panel
- Ustoz / Admin → login → `/admin.html`

Demo:
- student / student123
- admin / admin123

For production, change these passwords and set `JWT_SECRET`.
