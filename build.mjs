// Builds dist/index.html: same page, minified. Source of truth is index.html.
// Usage: node build.mjs   (uses npx for terser, csso and html-minifier-terser; no install step)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const src = readFileSync('index.html', 'utf8');
const run = (cmd, input) => execSync(cmd, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });

// minify every <style> and every <script> block in place
let out = src.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => `<style>${run('npx --yes csso-cli', css).trim()}</style>`);
out = out.replace(/<script>([\s\S]*?)<\/script>/g, (_, js) => {
  // the QR library block is already minified; just drop its licence comment. Everything else goes through terser.
  const isLib = js.includes('qrcode-generator 1.4.4');
  const min = isLib ? js.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '') : run('npx --yes terser -c -m', js);
  return `<script>${min.trim()}</script>`;
});
// collapse whitespace between tags and drop HTML comments
out = run('npx --yes html-minifier-terser --collapse-whitespace --remove-comments --conservative-collapse', out);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', out);
console.log(`index.html ${src.length} bytes → dist/index.html ${out.length} bytes`);
