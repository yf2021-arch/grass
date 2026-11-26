import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=new URL('../js/',import.meta.url);
const toURL=src=>'data:text/javascript;base64,'+Buffer.from(src).toString('base64');
let source=fs.readFileSync(new URL('bjt-learn.js',base),'utf8');
source=source.replace(/from '\.\/(bjt-core-[^']+\.js)'/g,(_,p)=>'from "'+toURL(fs.readFileSync(new URL(p,base),'utf8'))+'"');
const {BJT_ITEMS,stage,flow,grade,queue,question,createBjtLearn,visibleReading,spokenLabel}=await import(toURL(source));
assert.equal(BJT_ITEMS.length,900);assert.equal(new Set(BJT_ITEMS.map(x=>x.id)).size,900);
for(const [category,n] of Object.entries({'文法':150,'語彙':500,'連語':200,'敬語':50}))assert.equal(BJT_ITEMS.filter(x=>x.category===category).length,n);
for(const x of BJT_ITEMS){assert.equal(x.examples.length,2);assert.ok(x.english);assert.ok(spokenLabel(x));assert.equal(x.reading,visibleReading(x));for(const f of ['choice','typing']){const q=question(x,BJT_ITEMS,{},f);assert.equal(new Set(q.options).size,4);assert.ok(q.options.includes(x.meaning));assert.ok(q.answer);}}
assert.equal(visibleReading(BJT_ITEMS.find(x=>x.id==='g08')),'');assert.equal(spokenLabel(BJT_ITEMS.find(x=>x.id==='g08')),'ものの');assert.equal(visibleReading(BJT_ITEMS.find(x=>x.id==='v01')),'のうき');
assert.equal(visibleReading(BJT_ITEMS.find(x=>x.id==='g05')),'');
const now=1700000000000,day=86400000;let p=grade({}, {correct:true,now});assert.equal(p.streak,1);assert.equal(flow(p),'explain');p=grade(p,{correct:true,assisted:true,now:now+day});assert.equal(p.streak,1);assert.equal(flow(p),'drill');p=grade(p,{correct:true,now:now+2*day});assert.equal(p.streak,2);assert.equal(grade(p,{correct:false,now:now+3*day}).streak,0);
assert.equal(queue(BJT_ITEMS,{},{}).length,5);assert.equal(queue(BJT_ITEMS,{},{size:20,newLimit:15}).length,15);assert.equal(new Set(queue(BJT_ITEMS,{},{}).map(x=>x.category)).size,4);
const memory={};const s=createBjtLearn({app:{},esc:String,store:{get:async()=>null,put:async(_s,v,k)=>{memory[k]=v;}},rerender:()=>{}});await s.load();assert.match(s.render(),/BJT Core 900/);s.actions['bjt-l-start']();assert.match(s.render(),/納期が合わなかった/);s.actions['bjt-l-skip']();assert.match(s.render(),/explain the circumstances/);assert.equal(s._records().g01.streak,0);s.actions['bjt-l-retry']();assert.match(s.render(),/予算が確保できなかった/);s.actions['bjt-l-skip']();assert.equal(s._records().g01.attempts,1);s.actions['bjt-l-next']();assert.match(s.render(),/2 \/ 5/);
const saved={records:{g01:{attempts:2,streak:1,due:now,lastAttempt:now}},cfg:{size:5}};
const restored=createBjtLearn({app:{},esc:String,store:{get:async()=>saved,put:async()=>{}},rerender:()=>{}});await restored.load();assert.equal(restored._records().g01.attempts,2);
console.log('BJT Core 900 learning tests passed');
