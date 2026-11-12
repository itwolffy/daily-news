const test=require('node:test');
const assert=require('node:assert/strict');
const {parseModelJson,validateCuration,fallbackCuration,safeInsight}=require('../src/services/ai-curator');
const {blockForEvent}=require('../src/renderers/telegram');
const news=[
 {id:'valid-1',source:'HN',url:'https://news.example.com/story',title:'真实标题',summary:'真实摘要内容',category:'developer',score:80},
 {id:'valid-2',source:'Media B',url:'https://media-b.example.org/story',title:'另一来源标题',summary:'另一来源摘要',category:'developer',score:70},
 {id:'english-1',source:'HN',url:'https://example.com/en',title:'English title',summary:'English summary',category:'developer',score:60}
];
test('parses JSON and rejects malformed output',()=>{
 assert.deepEqual(parseModelJson('{"events":[]}'),{events:[]});
 assert.equal(parseModelJson('not json'),null);
});
test('resolves model source IDs only against collected records and labels multiple domains as reports',()=>{
 const r=validateCuration({dailyInsight:'今日洞察',topEventIds:['event-1'],events:[{sourceIds:['valid-1','valid-2','forged-id'],title:'中文标题',summary:'中文摘要',category:'finance',importance:9}]},news);
 assert.equal(r.events.length,1);
 assert.equal(r.events[0].sources.length,2);
 assert.equal(r.events[0].evidenceStatus,'多来源报道');
 assert.equal(r.events[0].sourceCount,2);
 assert.equal(r.events[0].importance,5);
});
test('high-risk personal or national-security allegations are always marked unverified',()=>{
 const r=validateCuration({events:[{sourceIds:['valid-1','valid-2'],title:'高管涉及间谍指控',summary:'媒体称其涉嫌间谍活动，但相关说法尚未独立核实',evidenceStatus:'多来源报道'}]},news);
 assert.equal(r.events[0].evidenceStatus,'未经独立核实');
});
test('single-source events are labeled as media reports, not confirmed facts',()=>{
 const r=validateCuration({events:[{sourceIds:['valid-1'],title:'中文标题',summary:'中文摘要',evidenceStatus:'媒体报道'}]},news);
 assert.equal(r.events[0].evidenceStatus,'媒体报道');
});
test('rejects model events whose title or summary is not Chinese',()=>{
 const r=validateCuration({events:[{sourceIds:['english-1'],title:'English title',summary:'English summary'}]},news);
 assert.equal(r,null);
});
test('fallback excludes English-only items and caps output at twelve',()=>{
 const items=Array.from({length:15},(_,i)=>({...news[0],id:'n'+i,title:'中文新闻 '+i,score:80-i}));
 items.push(news[2]);
 const result=fallbackCuration(items);
 assert.equal(result.events.length,12);
 assert.ok(result.events.every(e=>/[\u3400-\u9fff]/.test(e.title)&&/[\u3400-\u9fff]/.test(e.summary)));
 assert.ok(result.events.every(e=>e.evidenceStatus==='媒体报道'));
 assert.match(result.dailyInsight,/AI 整理暂不可用/);
});
test('daily insight is bounded without cutting off a complete sentence where possible',()=>{
 assert.equal(safeInsight('短句。'),'短句。');
 assert.ok(safeInsight('甲'.repeat(190)).endsWith('…'));
 assert.ok(safeInsight('甲'.repeat(90)+'。'+'乙'.repeat(100)).endsWith('。'));
});
test('Telegram event block displays evidence status and uses neutral impact-analysis label',()=>{
 const block=blockForEvent({title:'测试事件',importance:4,evidenceStatus:'未经独立核实',summary:'事实摘要',whyItMatters:'影响分析',sources:[]},0);
 assert.match(block,/未经独立核实/);
 assert.match(block,/影响分析/);
});
test('rejects invalid response structure',()=>assert.equal(validateCuration({events:{}},news),null));
