const axios=require('axios');const locks=new Map();
function config(){const url=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL,token=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN;return url&&token?{url:url.replace(/\/$/,''),token}:null;}
async function command(args){const c=config();if(!c)return null;const r=await axios.post(c.url,args,{timeout:4000,headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'}});return r.data&&r.data.result;}
async function claimDailyRun(day){const key='daily-news:run:'+day;if(!config()){if(locks.has(key))return false;locks.set(key,Date.now());return true;}return await command(['SET',key,'running','EX',7200,'NX'])==='OK';}
async function completeDailyRun(day){if(config())await command(['SET','daily-news:run:'+day,'done','EX',172800]);}
async function releaseDailyRun(day){if(!config()){locks.delete('daily-news:run:'+day);return;}await command(['DEL','daily-news:run:'+day]);}
async function getRecentEvents(){if(!config())return [];try{const v=await command(['GET','daily-news:recent-events']);const p=v?JSON.parse(v):[];return Array.isArray(p)?p:[];}catch(e){console.error('[StateStoreReadError]',e.message);return [];}}
async function saveRecentEvents(events,day){if(!config())return;const old=await getRecentEvents(),next=events.map(e=>({title:e.title,category:e.category,summary:e.summary,date:day})).concat(old).slice(0,80);await command(['SET','daily-news:recent-events',JSON.stringify(next),'EX',1209600]);}
module.exports={redisEnabled:()=>Boolean(config()),claimDailyRun,completeDailyRun,releaseDailyRun,getRecentEvents,saveRecentEvents};
