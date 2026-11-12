function escapeHtml(v=''){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}
function safeUrl(v){try{const u=new URL(String(v||''));return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return '';}}
const SOURCE_LABELS = {
  'Hacker News':'Hacker News 社区', GitHub:'GitHub 开源社区',
  TechCrunch:'TechCrunch 科技媒体', 'MIT Technology Review':'麻省理工科技评论',
  'OpenAI News':'OpenAI 官方', '知乎/V2EX':'知乎 / V2EX',
  '36氪':'36氪', '华尔街见闻':'华尔街见闻', '知乎':'知乎', V2EX:'V2EX', RSS:'RSS 订阅'
};
function sourceLabel(source){return SOURCE_LABELS[source] || source;}
function blockForEvent(e,i){
  const sources=(e.sources||[]).slice(0,3).map(s=>{
    const u=safeUrl(s.url), label=sourceLabel(s.source);
    return u?'<a href="'+escapeHtml(u)+'">'+escapeHtml(label)+'</a>':escapeHtml(label);
  }).join(' · ');
  return '<b>'+(i+1)+'. '+escapeHtml(e.title)+'</b> <code>重要性 '+e.importance+'/5'+(e.updateType==='update'?' · 后续进展':'')+'</code>'+(e.summary?'\n'+escapeHtml(e.summary):'')+(e.whyItMatters?'\n<i>为什么重要：</i>'+escapeHtml(e.whyItMatters):'')+(e.watchNext?'\n<i>后续关注：</i>'+escapeHtml(e.watchNext):'')+(sources?'\n<code>来源：</code>'+sources:'');
}
function chunkBlocks(blocks,max=3600){const out=[];let current='';for(const block of blocks.filter(Boolean)){if(block.length>max)throw new Error('Telegram 单个消息区块超过安全长度');const next=current?current+'\n\n'+block:block;if(next.length>max&&current){out.push(current);current=block;}else current=next;}if(current)out.push(current);return out;}
function buildMessages({dateHeader,headerBar,curation}){
  const events=curation.events||[],top=(curation.topStories||[]).slice(0,3),topIds=new Set(top.map(e=>e.id));
  const blocks=['<b>☀️ 每日智能早报 · '+escapeHtml(dateHeader)+'</b>'+(headerBar?'\n'+headerBar:''),
    curation.dailyInsight?'<b>📌 今日核心风向</b>\n'+escapeHtml(curation.dailyInsight):'',
    top.length?'<b>🔥 今日最重要的 '+top.length+' 件事</b>\n'+top.map(blockForEvent).join('\n\n'):''];
  [['aiTech','🤖 AI 与科技'],['business','💼 互联网与商业'],['finance','💰 宏观经济与投资'],['developer','🧑‍💻 开发者与开源'],['community','💬 社区讨论']].forEach(([key,label])=>{
    const list=events.filter(e=>e.category===key&&!topIds.has(e.id))
      .sort((a,b)=>b.importance-a.importance || (b.sources?.[0]?.score||0)-(a.sources?.[0]?.score||0)).slice(0,2);
    if(list.length)blocks.push('<b>'+label+'</b>\n'+list.map(blockForEvent).join('\n\n'));
  });
  blocks.push('<i>点击来源查看原文 · AI 摘要仅依据采集到的标题与摘要生成</i>');
  return chunkBlocks(blocks);
}
module.exports={escapeHtml,safeUrl,blockForEvent,chunkBlocks,buildMessages};
