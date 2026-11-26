import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../js/bjt-learn.js',import.meta.url),'utf8');
const {BJT_ITEMS,stage,flow,grade,queue,question,createBjtLearn}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
assert.equal(BJT_ITEMS.length,50);assert.equal(new Set(BJT_ITEMS.map(x=>x.id)).size,50);
for(const x of BJT_ITEMS){assert.equal(x.examples.length,2);for(const f of ['choice','typing']){const q=question(x,BJT_ITEMS,{},f);assert.equal(new Set(q.options).size,4);assert.ok(q.options.includes(x.meaning));assert.ok(q.answer);}}
const now=1700000000000,day=86400000;let p=grade({}, {correct:true,now});assert.equal(p.streak,1);assert.equal(flow(p),'explain');p=grade(p,{correct:true,assisted:true,now:now+day});assert.equal(p.streak,1);assert.equal(flow(p),'drill');p=grade(p,{correct:true,now:now+2*day});assert.equal(p.streak,2);assert.equal(grade(p,{correct:false,now:now+3*day}).streak,0);assert.equal(queue(BJT_ITEMS,{},{}).length,5);
const memory={};const s=createBjtLearn({app:{},esc:String,store:{get:async()=>null,put:async(_s,v,k)=>{memory[k]=v;}},rerender:()=>{}});await s.load();assert.match(s.render(),/ながら学習/);s.actions['bjt-l-start']();assert.match(s.render(),/意味は？/);s.actions['bjt-l-skip']();assert.equal(s._records().g01.streak,0);s.actions['bjt-l-retry']();s.actions['bjt-l-skip']();assert.equal(s._records().g01.attempts,1);s.actions['bjt-l-next']();assert.match(s.render(),/2 \/ 5/);console.log('BJT learning tests passed');

// A retry must use the other context without increasing mastery.
const t2=createBjtLearn({app:{},esc:String,store:{get:async()=>null,put:async()=>{}},rerender:()=>{}});await t2.load();t2.actions['bjt-l-start']();assert.match(t2.render(),/納期が合わなかった/);t2.actions['bjt-l-skip']();t2.actions['bjt-l-retry']();assert.match(t2.render(),/予算が確保できなかった/);
