// Launches the built app in smoke mode (see src/main/smoke.ts): first the desktop app, then the Android web app
// (www/, built by `npm run build:mobile`) in a phone-sized window. On Linux without a display, run under xvfb-run.
import { spawn } from 'node:child_process';
import electron from 'electron';

const args = ['.'];
if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');

function run(mode) {
  const { promise, resolve } = Promise.withResolvers();
  console.log(`# smoke: ${mode === 'mobile' ? 'Android web app at phone size' : 'desktop app'}`);
  const child = spawn(electron, args, { stdio: 'inherit', env: { ...process.env, CATEXAM_SMOKE: mode } });
  // Each run plays a full 60-second lightning round on top of the exam, training and the other game rounds
  // (300 s was too short for the desktop run); the check lines say how long each part took.
  const timer = setTimeout(() => {
    console.error(`SMOKE FAILED: ${mode} run timed out after 600 s`);
    child.kill('SIGKILL');
  }, 600_000);
  child.on('exit', (code) => {
    clearTimeout(timer);
    resolve(code ?? 1);
  });
  return promise;
}

for (const mode of ['1', 'mobile']) {
  const code = await run(mode);
  if (code !== 0) process.exit(code);
}
