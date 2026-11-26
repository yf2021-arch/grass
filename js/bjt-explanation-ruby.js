// Use known lexical readings; never assign isolated kanji an arbitrary on/kun reading.
export function buildExplanationReadings(items, align, targetText, supplemental){
 const candidates=new Map();
 const add=(w,r)=>{if(!w||!r||!/[\p{Script=Han}々]/u.test(w))return;if(!candidates.has(w))candidates.set(w,new Set());candidates.get(w).add(r);};
 for(const item of items){if(!item.reading)continue;const t=targetText(item);add(t,item.reading);for(const [w,r] of align(t,item.reading)){if(r&&/^[\p{Script=Han}々]{2,}$/u.test(w))add(w,r);}}
 const map=new Map([...candidates].filter(([w,r])=>r.size===1&&w.length>1).map(([w,r])=>[w,[...r][0]]));
 for(const [w,r] of Object.entries(supplemental))map.set(w,r);
 const byFirst=new Map();for(const [w,r] of map){if(!byFirst.has(w[0]))byFirst.set(w[0],[]);byFirst.get(w[0]).push([w,r]);}
 for(const list of byFirst.values())list.sort((a,b)=>b[0].length-a[0].length);
 return {map,byFirst};
}
const han=c=>!!c&&/[\p{Script=Han}々]/u.test(c);
export function explanationSegments(text, dictionary){
 const s=String(text??"");const {map,byFirst}=dictionary;const out=[];
 function addPlain(v){if(!v)return;const prev=out[out.length-1];if(typeof prev==="string")out[out.length-1]+=v;else out.push(v);}
 function exactRun(run){
  if(map.has(run))return [{w:run,r:map.get(run)}];
  // Only split a compound if all its kanji form known multi-kanji words.
  const memo=new Map();function split(i){if(i===run.length)return [];if(memo.has(i))return memo.get(i);for(const [w,r] of byFirst.get(run[i])||[]){if(w.length<2||!Array.from(w).every(han)||!run.startsWith(w,i))continue;const rest=split(i+w.length);if(rest){const v=[{w,r},...rest];memo.set(i,v);return v;}}memo.set(i,null);return null;}return split(0);
 }
 for(let i=0;i<s.length;){
   const hits=byFirst.get(s[i])||[];
   const hit=hits.find(([w])=>s.startsWith(w,i)&&(!han(w[0])||!han(s[i-1]))&&(!han(w[w.length-1])||!han(s[i+w.length])));
   if(hit){out.push({w:hit[0],r:hit[1]});i+=hit[0].length;continue;}
   if(han(s[i])){let j=i+1;while(han(s[j]))j++;const run=s.slice(i,j);const split=exactRun(run);if(split)out.push(...split);else addPlain(run);i=j;continue;}
   addPlain(s[i]);i++;
 }
 return out;
}
