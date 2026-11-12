const { http }=require('../utils/http');
const { getWeatherDesc }=require('../utils/weather');
function escapeHtml(v){return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}
async function fetchHeaderBar(){
 const city=process.env.WEATHER_CITY||'香港',lat=process.env.WEATHER_LAT||'22.3193',lon=process.env.WEATHER_LON||'114.1694';
 const results=await Promise.allSettled([
  http.get('https://api.open-meteo.com/v1/forecast?latitude='+encodeURIComponent(lat)+'&longitude='+encodeURIComponent(lon)+'&current=temperature_2m,weather_code&timezone=Asia%2FShanghai',{timeout:5000}),
  http.get('https://open.er-api.com/v6/latest/USD',{timeout:5000}),
  http.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',{timeout:5000})]);
 const parts=[];
 if(results[0].status==='fulfilled'&&results[0].value.data.current){const c=results[0].value.data.current;parts.push('<code>'+getWeatherDesc(c.weather_code)+' '+escapeHtml(city)+' '+Math.round(c.temperature_2m)+'°C</code>');}
 if(results[1].status==='fulfilled'){const rate=results[1].value.data.rates&&results[1].value.data.rates.CNY;if(Number.isFinite(Number(rate)))parts.push('<code>💵 USD/CNY '+Number(rate).toFixed(2)+'</code>');}
 if(results[2].status==='fulfilled'){const b=results[2].value.data.bitcoin;if(b&&Number.isFinite(Number(b.usd))){const c=Number(b.usd_24h_change)||0;parts.push('<code>🪙 BTC $'+Math.round(b.usd).toLocaleString('en-US')+' ('+(c>=0?'+':'')+c.toFixed(1)+'%)</code>');}}
 return parts.join(' ｜ ');
}
module.exports={fetchHeaderBar};
