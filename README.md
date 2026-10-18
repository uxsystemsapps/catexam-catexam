# CATExam

Windows desktop simulator of the CISSP Computerized Adaptive Testing (CAT) exam, for training candidates.
Electron + TypeScript.

## What it simulates

- **CAT rules** (English CISSP, from April 2024): 100–150 questions, 3 hours, 25 unscored pretest items
  hidden among the first 100. Adaptive difficulty (Rasch model, EAP estimate). The exam stops once the
  result is clear with 95% confidence, at 150 items, or when time runs out. On a timeout after 100 items,
  you pass only if your estimate stayed above the standard over the last 75 scored items.
- **Blueprint**: questions follow the 8 domain weights (16/10/13/13/13/12/13/10 %).
- **Test-centre flow**: NDA (5 minutes to accept), tutorial, one question at a time, every question
  must be answered, no going back, no flagging for review. Right-click strikes out an option. Breaks
  are allowed, but the clock keeps running. "End Exam" scores the exam as a fail.
- **Lockdown** from the NDA screen until the score report: kiosk full screen, always on top, hidden
  from screen capture, no close/reload/devtools/clipboard, common shortcuts blocked, no display sleep.
  Each time the window loses focus it is recorded as an incident and the window is brought back.
  Ctrl+Alt+Del and other OS-reserved keys cannot be blocked by an application.
- **Training**: a score report with a pass/fail result, a 0–1000 estimate (700 = pass) and a
  proficiency band per domain. Afterwards you can review every answer with its explanation. History is
  kept. A training mode (no lock, no clock) runs chosen domains and explains each answer as you go.

## Question bank

`questions/domain-*.json` holds 198 original starter questions across all 8 domains. Use **Import
question bank** to add more questions; each file is validated before it is copied into the profile.
Format:

```json
{ "name": "My bank", "questions": [
  { "id": "X-001", "domain": 1, "type": "single", "difficulty": 0.4,
    "stem": "…", "options": ["…", "…", "…", "…"], "answer": [2], "explanation": "…" } ] }
```

`type` is `single`, `multi` (`answer` lists every correct index) or `ordering` (`answer` is the correct order).
`difficulty` is in logits; 0 is the passing standard.
A realistic exam needs a much larger bank; with fewer than about 150 items per run, exams may end when
the bank runs out.

## Develop

Node 22.12 or newer.

```
npm ci
npm start              # run the app
npm run lint           # tsc + eslint
npm test               # engine unit tests
npm run smoke          # full exam driven through the real UI (Linux CI: xvfb-run -a npm run smoke)
npm run dist:win       # Windows NSIS installer in release/ (on Linux it needs wine)
```

The gates (`.gitea/workflows/gates.yml`) run lint, the tests and the smoke test on Linux. The
`windows-installer` job builds the unsigned NSIS installer on Linux (with wine) and attaches it to the
run as the `CATExam-windows-installer` artefact: open the run in Gitea → Actions and download it there.
There is no Windows runner, so nobody runs the installer or tests the Windows-specific lockdown
automatically. Windows SmartScreen warns about the unsigned installer ("More info" → "Run anyway").
