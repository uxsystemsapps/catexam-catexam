// Assembles dist/src/renderer: the compiled renderer script plus the static HTML and CSS.
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/src/renderer', { recursive: true });
cpSync('build/renderer/renderer/app.js', 'dist/src/renderer/app.js');
cpSync('src/renderer/index.html', 'dist/src/renderer/index.html');
cpSync('src/renderer/styles.css', 'dist/src/renderer/styles.css');
cpSync('assets/icon.svg', 'dist/src/renderer/icon.svg');
