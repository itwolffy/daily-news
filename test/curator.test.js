const test=require('node:test');
const assert=require('node:assert/strict');
const {parseModelJson,validateCuration,fallbackCuration}=require('../src/services/ai-curator');
const news=[
 {id:'valid-1',source:'HN',url:'https://example.com',title:'真实标题',summary:'真实摘要内容',category:'developer',score:80},
 {id:'english-1',source:'HN',url:'https://example.com/en',title:'English title',summary:'English summary',category:'developer',score:70}
];
test('parses JSON and rejects malformed output',()=>{
 assert.deepEqual(parseModelJson('{"events":[]}'),{events:[]});
 assert.equal(parseModelJson('not json'),null);
});
test('resolves model source IDs only against collected records',()=>{
 const r=validateCuration({dailyInsight:'今日洞察',topEventIds:['event-1'],events:[{sourceIds:['valid-1','forged-id'],title:'中文标题',summary:'中文摘要',category:'finance',importance:9}]},news);
 assert.equal(r.events.length,1);
 assert.equal(r.events[0].sources[0].url,'https://example.com');
 assert.equal(r.events[0].importance,5);
});
test('rejects model events whose title or summary is not Chinese',()=>{
 const r=validateCuration({events:[{sourceIds:['english-1'],title:'English title',summary:'English summary'}]},news);
 assert.equal(r,null);
});
test('fallback excludes English-only items and caps output at twelve',()=>{
 const items=Array.from({length:15},(_,i)=>({...news[0],id:'n'+i,title:'中文新闻 '+i,score:80-i}));
 items.push(news[1]);
 const result=fallbackCuration(items);
 assert.equal(result.events.length,12);
 assert.ok(result.events.every(e=>/[\u3400-\u9fff]/.test(e.title)&&/[\u3400-\u9fff]/.test(e.summary)));
 assert.match(result.dailyInsight,/AI 整理暂不可用/);
});
test('rejects invalid response structure',()=>assert.equal(validateCuration({events:{}},news),null));
