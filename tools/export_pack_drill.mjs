// Use exactly the PWA's conjugation rules, including personal vocabulary.
import { BASE_WORDS, wordFromCard, formsFor, conj } from '../js/katsuyo.js';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const seen = new Set();
const words = [...BASE_WORDS, ...JSON.parse(input || '[]').map(wordFromCard).filter(Boolean)]
  .filter(w => { if (seen.has(w.w)) return false; seen.add(w.w); return true; });
const jobs = words.flatMap(w => formsFor(w).map(form => {
  const group = form === 'group' || form === 'agroup';
  return { id: `KT-${w.w}`, key: form, text: group ? w.w : conj(w, form),
    yomi: w.r ? (group ? w.r : conj({ ...w, w: w.r }, form)) : '' };
}));
process.stdout.write(JSON.stringify(jobs));
