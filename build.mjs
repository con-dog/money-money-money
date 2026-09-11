// Builds dist/index.html: same page, minified. Source of truth is index.html.
// Usage: node build.mjs   (uses npx for terser, csso and html-minifier-terser; no install step)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';

const src = readFileSync('index.html', 'utf8');
const run = (cmd, input) => execSync(cmd, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });

// minify every <style> block; merge all <script> blocks into one so terser can mangle top-level names across them
let out = src.replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => `<style>${run('npx --yes csso-cli', css).trim()}</style>`);
const js = [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
out = out.replace(/<script>[\s\S]*?<\/script>\s*/g, '').replace('</body>', `<script>${run('npx --yes terser -c passes=2 -m --toplevel', js).trim()}</script></body>`);
// collapse whitespace between tags and drop HTML comments
out = run('npx --yes html-minifier-terser --collapse-whitespace --remove-comments --conservative-collapse', out);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.min.html', out);

// Packed build: the minified page deflated and embedded as raw bytes (not base64) inside a tiny loader that
// inflates it with the browser's native DecompressionStream and writes it into the document. Same origin, same URL
// hash, same localStorage, so links and saved budgets behave identically. dist/index.min.html is the unpacked equivalent.
//
// The bytes live in a <script type=text/plain> decoded as windows-1252, which maps every byte to one character.
// Four things the HTML parser would alter are escaped with 0x01: NUL, CR, the escape byte itself, and "</".
// zopfli (wasm, `npm i`) gives a few percent smaller deflate stream than zlib; fall back to zlib if it isn't installed
let raw = deflateRawSync(Buffer.from(out, 'utf8'), { level: 9 });
try { const zopfli = createRequire(import.meta.url)('@gfx/zopfli'); raw = Buffer.from(await zopfli.deflateAsync(Buffer.from(out, 'utf8'), { numiterations: 100 })); } catch { console.log('(zopfli not installed, using zlib)'); }
let body = '';
for (let i = 0; i < raw.length; i++) {
  const b = raw[i];
  if (b === 0) body += '\x01' + '0';
  else if (b === 13) body += '\x01' + 'r';
  else if (b === 1) body += '\x01' + 'e';
  else if (b === 0x3c && raw[i + 1] === 0x2f) body += '\x01' + 'l';
  else body += String.fromCharCode(b);
}
const loader = `<!doctype html><meta charset=windows-1252><script type=text/plain id=d>${body}</script><script>(async()=>{let T=new TextDecoder('windows-1252').decode(Uint8Array.from({length:256},(_,i)=>i)),s=d.textContent,b=[],i=0,c;for(;i<s.length;i++){c=s[i];b.push(c=='\\x01'?(c=s[++i],c=='0'?0:c=='r'?13:c=='e'?1:60):T.indexOf(c))}let x=new DecompressionStream('deflate-raw'),w=x.writable.getWriter();w.write(new Uint8Array(b));w.close();document.write(await new Response(x.readable).text());document.close()})()</script>`;
writeFileSync('dist/index.html', Buffer.from(loader, 'latin1'));
console.log(`index.html ${src.length} B → dist/index.min.html ${out.length} B → dist/index.html ${Buffer.byteLength(loader, 'latin1')} B (packed, ${raw.length} B deflated)`);
