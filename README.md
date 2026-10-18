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
  must be answered, no going back, no flagging for review. Right-click strikes out an option. Letter
  keys (A, B, C…) select an option and Enter moves on. Breaks are allowed, but the clock keeps running.
  "End Exam" asks for confirmation and scores the exam as a fail.
- **Progress bars** (training aid; the real exam shows only the clock and question number): time used
  out of 3 hours, questions answered against the 100–150 range, and a pace hint ("On pace" / "Behind
  pace by N questions") measured against finishing 150 questions in time (72 s per question).
- **Lockdown** from the NDA screen until the score report: kiosk full screen, always on top, hidden
  from screen capture, no close/reload/devtools/clipboard, common shortcuts blocked, no display sleep.
  Each time the window loses focus it is recorded as an incident and the window is brought back.
  Ctrl+Alt+Del and other OS-reserved keys cannot be blocked by an application.
- **Training**: a score report with a pass/fail result, a 0–1000 estimate shown against the 700 pass
  line, and a proficiency band per domain. Afterwards you can review every answer with its explanation,
  filtered by domain, by incorrect answers or by text. History is kept, with pass count and best score.
- **Training mode** (no lock): choose domains, question types, difficulty (easy below −0.5 logits, hard
  above 0.5, medium in between, or mixed), the number of questions, where they come from (whole bank,
  questions you last got wrong, or bookmarks), the order (random, new first, missed first) and an optional
  timer per question (a question that runs out of time counts as wrong). Each answer is marked right or
  wrong at once: your choice and the correct option(s) are highlighted, multi-select answers list what you
  missed or chose wrongly, ordering answers show each position, and the explanation follows (plus a note
  per option when the bank has `optionNotes`). The screen keeps a running score and streak; you can
  bookmark a question. The session ends with accuracy per domain and a button to retry the missed questions.
- **Study plan** on the home screen: countdown to your exam date, today's answers against your daily
  goal, how much of the bank you have practised, your weakest domain (once it has 5 training answers) and
  one-click sessions for missed, bookmarked or new questions.
- **History**: every exam (with its domain report) and training session, score and accuracy trends,
  training accuracy per domain; entries can be deleted one by one or all at once.
- **Profile & settings**: name, exam date, daily goal, light or dark theme, text size, and the default
  training settings. Training progress can be reset. Everything is stored in the application's profile
  folder (`profile.json`, `progress.json`, `history.json`, `training-history.json`).

## Question bank

The app ships 2,821 questions in `questions/`: 198 original starter questions (`domain-*.json`), the
reviewed CISSP dump per domain (`dump-domain*.json`, 1,307) and the OPT4 chapter and practice-test banks
(`opt4-*.json`, 1,316). Use **Import a
folder of question banks** to add more: every `.json` file in the chosen folder is validated, and the
valid ones are copied into the profile (`banks/`). One summary then lists how many files and questions
were added, the files skipped because a bank with the same `name` is already loaded, and the files that
failed with the validator's errors. Each imported bank has a **Remove** button on the home screen.
Format:

```json
{ "name": "My bank", "questions": [
  { "id": "X-001", "domain": 1, "type": "single", "difficulty": 0.4,
    "stem": "…", "options": ["…", "…", "…", "…"], "answer": [2], "explanation": "…" } ] }
```

`optionNotes` is optional: one string per option, shown in training feedback and in the exam review.
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
                       # CATEXAM_SMOKE_SHOTS=<dir> also saves screenshots of the main screens
npm run dist:win       # Windows NSIS installer in release/ (on Linux it needs wine)
```

The gates (`.gitea/workflows/gates.yml`) run lint, the tests and the smoke test on Linux. The
`windows-installer` job builds the unsigned NSIS installer on Linux (with wine) and attaches it to the
run as the `CATExam-windows-installer` artefact: open the run in Gitea → Actions and download it there.
There is no Windows runner, so nobody runs the installer or tests the Windows-specific lockdown
automatically. Windows SmartScreen warns about the unsigned installer ("More info" → "Run anyway").
