// Builds tools/ref-bigrams.json from the reference page's visible copy so the copy gate can compare against it.
// usage: node tools/ref-corpus.mjs <path-to-saved-reference-html>
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync(process.argv[2], 'utf8')
  .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const words = html.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) || [];
const bigrams = new Set();
for (let i = 0; i < words.length - 1; i++) bigrams.add(words[i] + ' ' + words[i + 1]);
writeFileSync(new URL('./ref-bigrams.json', import.meta.url), JSON.stringify({ words: [...new Set(words)].sort(), bigrams: [...bigrams].sort() }));
console.log('words', new Set(words).size, 'bigrams', bigrams.size);
