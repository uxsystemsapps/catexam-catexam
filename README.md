![CAT CISSP Exams](assets/logo.png)

# CAT CISSP Exams

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
  question reopens locked, with its feedback. **Pause** saves the session to finish later: the **Paused
  sessions** page (from the training card) lists paused sessions with their progress, and **Resume** reopens
  one on the question where it was left, with its answers and skips. The session ends with accuracy per
  domain and a button to retry the missed questions.
- **Game mode** (no lock): the same question bank as a pixel-art arcade game. The **world map** has eight
  islands, one per domain (Risk Reef, Asset Atoll, The Crypto Caves, Packet Peninsula, Fortress of Access
  Control, Pentest Dunes, SOC Glacier, Code Cove) along a dotted path. Tap an island and the hoodie cat walks
  there; the panel below shows the island and its boss. **Play island** asks six questions of that domain,
  then its **boss** (The Risk Hydra, The Data Leak Blob, The Side-Channel Golem, The Phishing Kraken, The
  Privilege Lich, The Orb of a Thousand Scans, The Ransomware Dragon, The Zero-Day Bug) fights with the
  domain's hardest questions (above 0.5 logits, topped up with the hardest of the rest): each right answer
  hits it (its health bar drops, it flashes white and shakes; five hits win, plus a 100 XP bonus), each wrong
  one costs a heart (it lunges and gloats), with three hearts for the whole island. The boss idles, explodes
  when beaten and a victory screen follows; losing gives a funny game over and **Retry boss** (once the stage
  is won, the boss can also be fought again from the map). A beaten boss clears its island: it lights up and
  comes alive (glow, bobbing, a waving flag, sparkles) and the path leaving it turns gold and marches. Cleared
  islands and the island where the cat stands are kept between sessions. **Quick round** keeps the stage 1
  round: tap islands to plant your flag on the domains to play, pick difficulty, round length (5–30), timer
  and pool (whole bank or your mistakes) with pixel buttons, and press start. A right answer earns XP (10 easy,
  20 medium, 30 hard),
  five in a row start **Encryption Frenzy** (double XP, a growing flame, glowing screen edges, x2 and then x3
  from ten in a row), and a wrong or timed-out answer breaks one of three hearts; the round ends when the hearts
  or the questions run out, with a funny line, the score and **Retry**. XP fills a level bar and earns ranks (Intern →
  Password123 Survivor → … → Firewall Whisperer → … → CISO of Doom); XP, best combo and rounds are kept.
  A pixel cat in a hoodie cheers on a right answer, facepalms and then cries on a wrong one, sweats when the
  timer runs low and cries at game over. Effects: READY/GO, coins flying into the XP bar, sparks, streak
  shouts, a red flash and a falling heart, drop-in titles and a level-up screen with spinning rays.
  Each answer gets a cheeky security joke (or a boss taunt), and then always the verdict and the bank's
  explanation; effects never cover it (the level-up, victory and game-over screens come after **Next**).
  Answers count as training answers: wrong ones join the questions to retry, and they count towards the
  daily goal. Sound effects (right ding, wrong buzz, combo whoosh, level-up fanfare, coin clink) and **music**
  (a looping track for the map and the rounds before a boss, another for boss fights; a third is ready for the
  lightning round of stage 3) each have their own on/off switch and volume, in Profile & settings and as ♪ and
  ♫ buttons on the game screen; both are **off by default on Android**, and the music pauses while the app is
  in the background. **Lite effects** drops particles, shaking and bouncing (a boss still flashes when hit and
  fades when beaten); when the system asks to reduce motion, nothing animates. Art, font, sounds and music are
  CC0 assets listed in `assets/CREDITS.md` and under **Credits** in Profile & settings.
- **Study plan** on the home screen: countdown to your exam date, today's answers against your daily
  goal, how much of the bank you have practised, your weakest domain (once it has 5 training answers) and
  one-click sessions for missed, bookmarked or new questions.
- **History**: every exam (with its domain report) and training session, score and accuracy trends,
  training accuracy per domain; entries can be deleted one by one or all at once. **Review** reopens a past
  exam with every question, your answer, the correct answer and the explanation (exams taken with earlier
  versions have no saved answers).
- **Setup wizard** on first start: first and second name, exam date and daily goal, training preferences,
  and appearance. The exam screens use the name from the profile; the home screen has no name box.
- **Profile & settings**: first and second name, exam date, daily goal, light or dark theme, text size, the
  default training settings, the game's sound and music (each with its volume) and lite effects, and the credits of the game assets.
  Training progress can be reset. Everything is stored in the application's profile folder (on the desktop it
  is still named `CATExam`, the app's former name): `profile.json`, `progress.json`, `history.json`,
  `training-history.json` and `game.json` (XP, best combo, game settings, cleared islands), plus one file
  per exam with its answered questions (`history/`) and one per paused training session (`paused/`).

## Android app

The phone app has every feature of the desktop app, laid out for a touch screen:

- **Navigation**: a bottom tab bar of icons (house: Home, cap: Train, gamepad: Game, clock: History, gear: Settings; screen
  readers read the names) on the start and history screens, with the current section marked (Train opens the
  start screen at the training card); the
  Android back button closes a dialog or the question list, then goes back one screen. During the exam it
  does nothing (no going back); during training it offers to pause or stop the session.
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

The cat icon and the logo are drawn in `assets/icon.svg` and `assets/logo.svg` (the logo's text is in paths,
so no font is needed). `assets/icon.png` (512 px) is the Windows installer and app icon; the app's top bar
and favicon use `icon.svg`. The Android launcher icons (`android/app/src/main/res/mipmap-*`, background
colour in `values/ic_launcher_background.xml`) are PNG renders of the same cat: re-render them from the SVG
if the cat changes.

Game mode: scoring, hearts, levels, ranks, islands and bosses are in `src/engine/game.ts` (stage 3, with power-ups,
achievements, the daily challenge and the lightning round, builds on `GameRun` and `GameProgress`; the
lightning round's music track is already in `assets/game/music/` and the `Track` type); its screens, effects
and music player are in `src/renderer/game.ts`, a second renderer script loaded before `app.js` that shares its
global scope. The game's art, font, sounds and music are in `assets/game/` (copied next to the renderer by the
build) and their sources and licences in `assets/CREDITS.md`; add a new asset to both that file and `GAME_CREDITS`.

The gates (`.gitea/workflows/gates.yml`) run lint, the tests and the smoke test on Linux. The
`windows-installer` job builds the unsigned NSIS installer on Linux (with wine) and attaches it to the
run as the `CATExam-windows-installer` artefact; the `android-apk` job builds the APK and attaches it as the
`CATExam-android-apk` artefact: open the run in Gitea → Actions and download them there.
The jobs run in the CI build image `catexam/catexam-ci` (`ci/Dockerfile`: JDK 21, Android SDK, Gradle, wine and
warm npm/Electron/Gradle caches) from Gitea's container registry. The first job, `image`, builds and pushes it
(kaniko) only when `ci/Dockerfile`, `package-lock.json` or the Gradle wrapper changed; then lint and test run,
then smoke, then `windows-installer` and `android-apk`. Registry access uses the repository secrets
`REGISTRY_USER` and `REGISTRY_TOKEN` (a Gitea token with read and write on packages) when they are set.
There is no Windows runner and no Android device or emulator, so nobody runs the installer, the Windows
lockdown or the APK automatically; the smoke test checks the Android screens in a phone-sized Chromium
window instead. Windows SmartScreen warns about the unsigned installer ("More info" → "Run anyway").
