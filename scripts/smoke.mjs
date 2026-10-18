// Launches the built app in smoke mode (see src/main/smoke.ts). On Linux without a display, run under xvfb-run.
import { spawn } from 'node:child_process';
import electron from 'electron';

const args = ['.'];
if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu');
const child = spawn(electron, args, { stdio: 'inherit', env: { ...process.env, CATEXAM_SMOKE: '1' } });
const timer = setTimeout(() => {
  console.error('SMOKE FAILED: timed out after 180 s');
  child.kill('SIGKILL');
  process.exit(1);
}, 180_000);
child.on('exit', (code) => {
  clearTimeout(timer);
  process.exit(code ?? 1);
});
