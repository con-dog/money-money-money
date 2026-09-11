// Builds dist/index.html: same page, minified. Source of truth is index.html.
// Usage: node build.mjs   (uses npx for terser, csso and html-minifier-terser; no install step)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';

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
writeFileSync('dist/index.min.html', out);

// Packed build: the minified page deflated and base64-embedded in a tiny loader that inflates it with the
// browser's native DecompressionStream and writes it into the document. Same origin, same URL hash, same
// localStorage, so links and saved budgets behave identically. dist/index.min.html is the unpacked equivalent.
const packed = deflateRawSync(Buffer.from(out, 'utf8'), { level: 9 }).toString('base64');
const loader = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Household Budget</title></head><body><script>(async()=>{const d=new DecompressionStream('deflate-raw'),w=d.writable.getWriter();w.write(Uint8Array.from(atob('${packed}'),c=>c.charCodeAt(0)));w.close();const t=await new Response(d.readable).text();document.open();document.write(t);document.close()})()</script></body></html>`;
writeFileSync('dist/index.html', loader);
console.log(`index.html ${src.length} B → dist/index.min.html ${out.length} B → dist/index.html ${loader.length} B (packed)`);
