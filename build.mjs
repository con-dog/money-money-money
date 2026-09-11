// Builds dist/index.html: same page, minified. Source of truth is index.html.
// Usage: node build.mjs   (uses npx for terser, csso and html-minifier-terser; no install step)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const src = readFileSync('index.html', 'utf8');

// Link format lock. Anything that changes what a link means (tag lists, VERSION, the serialisation code) is hashed;
// if the hash changes while VERSION stays the same the build fails. Bump VERSION (and keep the old decoder) to proceed.
const version = +src.match(/const VERSION = (\d+);/)[1];
const formatText = [...src.matchAll(/parseTags\('([^']*)'\)/g)].map(m => m[1]).join('|') + src.slice(src.indexOf('function encode('), src.indexOf('// base32'));
const formatHash = createHash('sha256').update(formatText).digest('hex').slice(0, 16);
let lock = {}; try { lock = JSON.parse(readFileSync('format.lock.json', 'utf8')); } catch {}
if (lock.version === version && lock.hash && lock.hash !== formatHash) {
  console.error(`Link format changed but VERSION is still ${version}. Bump VERSION and keep a decoder for v${version}, or restore the tag lists.`);
  process.exit(1);
}
writeFileSync('format.lock.json', JSON.stringify({ version, hash: formatHash }, null, 2) + '\n');
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
// Shorten class, id and data-attribute names. The minifier can't touch these because they live in CSS and in
// HTML strings, so they're renamed here by context: ".name" selectors, id="name" / #name, class attribute values
// (plain string literals made only of class names), and data-name attributes with their dataset.name reads.
const CLASSES = 'tagcell sortable splitopts summary sheet tabs small snapped dragging drag total red gi col off on neg pos arrow page w-amt w-conv w-del amt who w-amt2'.split(' ');
const IDS = 'track pos nav prev next addPerson period forecast savsum share qr shareBtn shareMsg page1 page2 page3 bottom undo redo'.split(' ');
const DATA = 'act tab sort drag go kind owner pid id f'.split(' ');
const short = i => (i < 26 ? String.fromCharCode(97 + i) : 'a' + String.fromCharCode(71 + i)); // a..z, aA..
const esc = t => t.replace(/-/g, '\\-');
function shorten(html) {
  const count = (re) => (html.match(re) || []).length;
  const cmap = Object.fromEntries(CLASSES.map((c, i) => [c, short(i)])), alt = CLASSES.map(esc).join('|');
  // quoted lists made only of class names (class attributes, classList calls, selector strings)
  const listRe = new RegExp(`(?<!(?:id|for|name|type|title|placeholder|value)=)(["'])( ?(?:${alt})(?: (?:${alt}))* ?)\\1`, 'g');
  html = html.replace(listRe, (m, q, list) => q + list.replace(new RegExp(`(?<![\\w-])(?:${alt})(?![\\w-])`, 'g'), w => cmap[w]) + q);
  CLASSES.forEach(c => {
    const re = new RegExp(`(?<![\\w$)\\]])\\.${esc(c)}(?![\\w-])`, 'g');
    if (!count(re)) throw new Error('class selector not found: ' + c);
    html = html.replace(re, '.' + cmap[c]);
  });
  IDS.forEach((id, i) => {
    const n = 'i' + short(i), re1 = new RegExp(`#${id}(?![\\w-])`, 'g'), re2 = new RegExp(`id="${id}"`, 'g');
    if (!count(re1) || !count(re2)) throw new Error('id not found: ' + id);
    html = html.replace(re1, '#' + n).replace(re2, `id="${n}"`);
  });
  DATA.forEach((d, i) => {
    const n = short(i), re1 = new RegExp(`data-${d}(?![\\w-])`, 'g'), re2 = new RegExp(`dataset\\.${d}(?![\\w])`, 'g');
    if (!count(re1)) throw new Error('data attribute not found: ' + d);
    html = html.replace(re1, 'data-' + n).replace(re2, 'dataset.' + n);
  });
  return html;
}
out = shorten(out);
writeFileSync('dist/index.min.html', out);

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
