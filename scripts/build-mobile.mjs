// Assembles www/, the web app of the Android build (Capacitor copies it into the APK): the shared renderer
// script and CSS from dist/ (run `npm run build` first), the bundled Android API, and the question banks.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
rmSync('www', { recursive: true, force: true });
mkdirSync('www/questions', { recursive: true });
await build({
  entryPoints: ['src/mobile/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  outfile: 'www/mobile.js',
  define: { CATEXAM_VERSION: JSON.stringify(version) },
  logLevel: 'warning',
});
cpSync('dist/src/renderer/app.js', 'www/app.js');
cpSync('dist/src/renderer/styles.css', 'www/styles.css');
cpSync('dist/src/renderer/icon.svg', 'www/icon.svg');
cpSync('src/mobile/index.html', 'www/index.html');
const banks = readdirSync('questions').filter((n) => n.endsWith('.json')).sort();
for (const name of banks) cpSync(`questions/${name}`, `www/questions/${name}`);
writeFileSync('www/questions/index.json', JSON.stringify(banks));
