// Assembles dist/src/renderer: the compiled renderer scripts plus the static HTML and CSS, the icon and the game assets.
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/src/renderer', { recursive: true });
cpSync('build/renderer/renderer/app.js', 'dist/src/renderer/app.js');
cpSync('build/renderer/renderer/game.js', 'dist/src/renderer/game.js');
cpSync('src/renderer/index.html', 'dist/src/renderer/index.html');
cpSync('src/renderer/styles.css', 'dist/src/renderer/styles.css');
cpSync('assets/icon.svg', 'dist/src/renderer/icon.svg');
cpSync('assets/game', 'dist/src/renderer/game', { recursive: true });
