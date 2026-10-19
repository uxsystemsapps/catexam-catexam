# CATExam

Simulator of the CISSP Computerized Adaptive Testing (CAT) exam, for training candidates: a Windows desktop app
and an Android phone app with the same features. Electron + TypeScript; the Android app is built with Capacitor.

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
  pace by N questions") measured against finishing 150 questions in time (72 s per question). A side panel
  shows one box per question (answered, current, still to come, and those past 100 that may follow); it is
  read-only, since the exam has no going back.
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
  bookmark a question. A side panel shows one box per question, coloured as correct, wrong, timed out,
  skipped or not answered, with a star when bookmarked; click a box to open that question. **Skip** leaves
  a question for later (it comes back after the others) and **Back** opens the previous one; an answered
  question reopens locked, with its feedback. The session ends with accuracy per domain and a button to
  retry the missed questions.
- **Study plan** on the home screen: countdown to your exam date, today's answers against your daily
  goal, how much of the bank you have practised, your weakest domain (once it has 5 training answers) and
  one-click sessions for missed, bookmarked or new questions.
- **History**: every exam (with its domain report) and training session, score and accuracy trends,
  training accuracy per domain; entries can be deleted one by one or all at once.
- **Profile & settings**: name, exam date, daily goal, light or dark theme, text size, and the default
  training settings. Training progress can be reset. Everything is stored in the application's profile
  folder (`profile.json`, `progress.json`, `history.json`, `training-history.json`).

## Android app

The phone app has every feature of the desktop app, laid out for a touch screen:

- **Navigation**: a bottom tab bar (Home, Train, History, Settings) on the start and history screens; the
  Android back button closes a dialog or the question list, then goes back one screen. During the exam it
  does nothing (no going back); during training it asks before stopping the session.
- **Questions**: large options to tap; touch and hold an option to strike it out; ordering items are dragged by
  their handle (⋮⋮) or moved with the arrows. The question list opens as a sheet from the **Questions** button.
  Long tables hide their less important columns.
- **Exam lock**: from the NDA screen until the score report, the app is pinned to the screen (Android asks the
  candidate to confirm the pinning), screenshots and screen recording are blocked, and the screen stays on.
  Leaving the app is recorded as an incident. Android does not let an ordinary app block the home button
  completely, so the lock is weaker than on the desktop.
- **Question banks**: the 2,821 questions are inside the app. **Import question bank files** opens the system
  file picker (choose one or several `.json` files; Android has no folder picker for this); the summary is
  the same as on the desktop.
- **Data** (profile, progress, history, imported banks) stays in the app's private storage on the phone. It
  is deleted when the app is uninstalled.
- **Text size** (Profile & settings) zooms the whole screen, as on the desktop.

Installing: download the `CATExam-android-apk` artefact of a gates run (Gitea → Actions), copy
`CATExam-android.apk` to the phone and open it; Android asks to allow installing apps from that source.
The APK is signed with a debug key that changes with each build, so installing a newer build over an older
one fails: uninstall the old one first (this deletes its data). Publishing on Google Play needs a release
signing key.

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
npm start              # run the desktop app
npm run lint           # tsc + eslint
npm test               # engine and storage unit tests
npm run smoke          # full exam driven through the real UI, desktop then Android web app at phone size
                       # (Linux CI: xvfb-run -a npm run smoke)
                       # CATEXAM_SMOKE_SHOTS=<dir> also saves screenshots of the main screens (phone-*.png)
npm run dist:win       # Windows NSIS installer in release/ (on Linux it needs wine)
npm run build:mobile   # Android web app in www/
npm run dist:android   # Android APK in android/app/build/outputs/apk/debug/ (needs JDK 21 and the
                       # Android SDK: JAVA_HOME, ANDROID_HOME)
```

The application logic (question banks, profile, history, exam and training sessions) is in `src/core` and
`src/engine`. The desktop app runs it in the Electron main process (`src/main`) and stores the profile in
files; the Android app runs it inside the web view (`src/mobile`) and stores the profile in IndexedDB. Both
show the same screens (`src/renderer`); the phone layout is the `max-width: 760px` part of `styles.css`.
`android/` is the Capacitor Android project; `ExamLockPlugin.java` is the exam lock.

The gates (`.gitea/workflows/gates.yml`) run lint, the tests and the smoke test on Linux. The
`windows-installer` job builds the unsigned NSIS installer on Linux (with wine) and attaches it to the
run as the `CATExam-windows-installer` artefact; the `android-apk` job builds the APK and attaches it as the
`CATExam-android-apk` artefact: open the run in Gitea → Actions and download them there.
There is no Windows runner and no Android device or emulator, so nobody runs the installer, the Windows
lockdown or the APK automatically; the smoke test checks the Android screens in a phone-sized Chromium
window instead. Windows SmartScreen warns about the unsigned installer ("More info" → "Run anyway").
