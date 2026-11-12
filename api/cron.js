// 放在 module.exports 上方：记录最近一次触发时间戳（防并发连发）
let lastTriggeredAt = 0;

module.exports = async (req, res) => {
  // 1. 只允许 GET 请求（拦截 HEAD 链接预览探测与 OPTIONS 请求）
  if (req.method && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 2. 拦截浏览器地址栏的预加载 (Prefetch / Prerender) 请求
  const purpose = req.headers?.['purpose'] || req.headers?.['sec-purpose'] || '';
  if (/prefetch|preview|prerender/i.test(purpose)) {
    return res.status(204).end();
  }

  // 3. 60 秒防重锁：防止浏览器超时重试导致连发多条
  const now = Date.now();
  if (now - lastTriggeredAt < 60 * 1000) {
    return res.status(429).json({
      success: false,
      message: '请求过于频繁，60秒内已触发过一次推送'
    });
  }
  lastTriggeredAt = now;

const axios = require('axios');

// 复用 axios 实例并配置模拟浏览器请求头
const http = axios.create({
  timeout: 6500,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  }
});

/**
 * 转义 Telegram HTML 特殊字符，防止标签解析报错
 */
function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 获取北京时间日期与星期 (例如：2026-11-12 周四)
 */
function getBeijingDateWithWeekday() {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  const weekdayStr = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short'
  }).format(now);

  return `${dateStr} ${weekdayStr}`;
}

/**
 * 将 Unix 秒级时间戳格式化为北京时间 HH:mm
 */
function formatTimeHHMM(unixSeconds) {
  if (!unixSeconds) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(unixSeconds * 1000));
}

/**
 * WMO 天气代码映射
 */
function getWeatherDesc(code) {
  const map = {
    0: '☀️ 晴',
    1: '🌤 晴间多云',
    2: '⛅ 多云',
    3: '☁️ 阴',
    45: '🌫 雾',
    48: '🌫 雾凇',
    51: '🌧 小毛毛雨',
    53: '🌧 毛毛雨',
    55: '🌧 密集毛毛雨',
    61: '🌧 小雨',
    63: '🌧 中雨',
    65: '🌧 大雨',
    71: '❄️ 小雪',
    73: '❄️ 中雪',
    75: '❄️ 大雪',
    80: '🌦 阵雨',
    81: '🌦 强阵雨',
    82: '⛈ 暴雨',
    95: '⛈ 雷阵雨'
  };
  return map[code] || '🌤 多云';
}

/**
 * 顶部状态栏：实时天气 + USD/CNY 汇率 + BTC 行情
 */
async function fetchHeaderBar() {
  const city = process.env.WEATHER_CITY || '香港';
  const lat = process.env.WEATHER_LAT || '22.3193';
  const lon = process.env.WEATHER_LON || '114.1694';

  const [weatherRes, fxRes, btcRes] = await Promise.allSettled([
    http.get(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=Asia%2FShanghai`,
      { timeout: 4000 }
    ),
    http.get('https://open.er-api.com/v6/latest/USD', { timeout: 4000 }),
    http.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',
      { timeout: 4000 }
    )
  ]);

  const parts = [];

  if (weatherRes.status === 'fulfilled' && weatherRes.value.data?.current) {
    const { temperature_2m, weather_code } = weatherRes.value.data.current;
    parts.push(`<code>${getWeatherDesc(weather_code)} ${city} ${Math.round(temperature_2m)}°C</code>`);
  }

  if (fxRes.status === 'fulfilled' && fxRes.value.data?.rates?.CNY) {
    const cny = Number(fxRes.value.data.rates.CNY).toFixed(2);
    parts.push(`<code>💵 USD/CNY ${cny}</code>`);
  }

  if (btcRes.status === 'fulfilled' && btcRes.value.data?.bitcoin?.usd) {
    const btc = btcRes.value.data.bitcoin;
    const price = Math.round(btc.usd).toLocaleString('en-US');
    const change = Number(btc.usd_24h_change || 0);
    const sign = change >= 0 ? '+' : '';
    parts.push(`<code>🪙 BTC $${price} (${sign}${change.toFixed(1)}%)</code>`);
  }

  return parts.join(' ｜ ');
}

/**
 * 信源 1：全球科技与开源先锋 (Hacker News 热门 + GitHub 近7日飙升开源项目)
 */
async function fetchGlobalTechRaw() {
  const results = [];

  const [hnRes, ghRes] = await Promise.allSettled([
    http.get('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=5'),
    http.get(
      `https://api.github.com/search/repositories?q=created:>${new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10)}&sort=stars&order=desc&per_page=3`,
      {
        headers: {
          Accept: 'application/vnd.github+json'
        }
      }
    )
  ]);

  if (hnRes.status === 'fulfilled' && Array.isArray(hnRes.value.data?.hits)) {
    hnRes.value.data.hits.slice(0, 4).forEach((hit) => {
      if (hit?.title) {
        results.push({
          title: hit.title,
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          tag: `HN 🔥 ${hit.points || 0} pts`,
          summary: `Hacker News 热议 (${hit.num_comments || 0} 条评论)`
        });
      }
    });
  }

  if (ghRes.status === 'fulfilled' && Array.isArray(ghRes.value.data?.items)) {
    ghRes.value.data.items.slice(0, 2).forEach((repo) => {
      if (repo?.full_name) {
        results.push({
          title: `[GitHub] ${repo.full_name}: ${repo.description || '热门开源项目'}`,
          url: repo.html_url,
          tag: `⭐ ${repo.stargazers_count || 0}`,
          summary: repo.description || ''
        });
      }
    });
  }

  return results;
}

/**
 * 信源 2：国内科技与商业 (36氪热榜官方接口)
 */
async function fetch36KrRaw() {
  try {
    const { data } = await http.post(
      'https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot',
      {
        partner_id: 'web',
        timestamp: Date.now(),
        param: { siteId: 1, platformId: 2 }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://36kr.com',
          Referer: 'https://36kr.com/'
        }
      }
    );

    const list = data?.data?.hotRankList || data?.hotRankList || [];
    return list.slice(0, 6).map((entry) => {
      const mat = entry?.templateMaterial || entry;
      const id = entry?.itemId || mat?.itemId || entry?.id;
      const stat = mat?.statRead ? `🔥 ${Math.round(mat.statRead / 1000) / 10}万` : '36氪热榜';
      return {
        title: mat?.widgetTitle || entry?.title || '',
        url: entry?.url || (id ? `https://36kr.com/p/${id}` : 'https://36kr.com/hot-list/catalog'),
        tag: stat,
        summary: mat?.summary || ''
      };
    }).filter((i) => i.title);
  } catch (err) {
    console.error('[FetchError] 36Kr:', err.message);
    return [];
  }
}

/**
 * 信源 3：全球宏观与金融快讯 (华尔街见闻 7x24 快讯流)
 */
async function fetchWallstreetcnRaw() {
  try {
    const { data } = await http.get(
      'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=8',
      {
        headers: { Referer: 'https://wallstreetcn.com/' }
      }
    );

    const list = Array.isArray(data?.data?.items) ? data.data.items : [];
    return list.slice(0, 6).map((entry) => {
      const rawText = (
        entry?.title ||
        entry?.content_text ||
        (entry?.content || '').replace(/<[^>]+>/g, '')
      ).replace(/\s+/g, ' ').trim();

      return {
        title: rawText.length > 60 ? `${rawText.slice(0, 60)}...` : rawText,
        url:
          entry?.uri ||
          (entry?.id ? `https://wallstreetcn.com/livenews/${entry.id}` : 'https://wallstreetcn.com/live/global'),
        tag: formatTimeHHMM(entry?.display_time) || '快讯',
        summary: rawText
      };
    }).filter((i) => i.title);
  } catch (err) {
    console.error('[FetchError] WallstreetCN:', err.message);
    return [];
  }
}

/**
 * 信源 4：高赞行业与社会热议 (知乎热榜 + V2EX 最热讨论双保险)
 */
async function fetchCommunityHotRaw() {
  const items = [];
  const [zhihuRes, v2exRes] = await Promise.allSettled([
    http.get('https://api.zhihu.com/topstory/hot-list?limit=8&reverse_order=0', {
      headers: { Referer: 'https://www.zhihu.com/hot' }
    }),
    http.get('https://www.v2ex.com/api/topics/hot.json')
  ]);

  if (zhihuRes.status === 'fulfilled' && Array.isArray(zhihuRes.value.data?.data)) {
    zhihuRes.value.data.data.slice(0, 5).forEach((entry) => {
      const target = entry?.target || entry;
      const qid = target?.id;
      const rawUrl = target?.url || '';
      items.push({
        title: target?.title || entry?.title || '',
        url: qid
          ? `https://www.zhihu.com/question/${qid}`
          : rawUrl.replace('api.zhihu.com/questions/', 'www.zhihu.com/question/'),
        tag: entry?.detail_text ? `🔥 ${entry.detail_text}` : '知乎热榜',
        summary: target?.excerpt || ''
      });
    });
  }

  if (v2exRes.status === 'fulfilled' && Array.isArray(v2exRes.value.data)) {
    v2exRes.value.data.slice(0, 3).forEach((topic) => {
      if (topic?.title) {
        items.push({
          title: `[V2EX] ${topic.title}`,
          url: topic.url || `https://www.v2ex.com/t/${topic.id}`,
          tag: `💬 ${topic.replies || 0}回复`,
          summary: (topic.content || '').slice(0, 120)
        });
      }
    });
  }

  return items.filter((i) => i.title);
}

/**
 * 调用 DeepSeek API 对多源原始资讯进行去重、去标题党、筛选 Top 3 并生成一句话高密度洞察
 */
async function curateWithDeepSeek(rawSources, apiKey) {
  if (!apiKey) return null;

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

  const systemPrompt = `你是一位顶尖科技与商业早报主编。请根据输入的四个原始资讯池（globalTech, domesticTech, finance, community），完成筛选与提炼并严格输出 JSON：
1. 过滤掉明星八卦、纯情绪宣泄、软文广告与无营养水贴。
2. 生成 "dailyInsight"：用 1~2 句话（不超过 75 字）高屋建瓴地总结今日全球科技、AI、宏观商业的核心风向。
3. 从每个分类池中各精选出最有价值的 3 条（如果原池不足 3 条则按实际数量）：
   - "title": 将英文标题或悬念式标题党改写为清晰、客观的中文事实标题（保留专有名词如 OpenAI、GitHub 项目名）。
   - "url": 必须原样保留输入中的原始 url，严禁修改或编造。
   - "tag": 保留输入中的 tag。
   - "takeaway": 用 20~35 字提炼该事件的核心事实、技术亮点或商业影响（不要重复标题）。

严格按以下 JSON 格式返回：
{
  "dailyInsight": "...",
  "globalTech": [{ "title": "...", "url": "...", "tag": "...", "takeaway": "..." }],
  "domesticTech": [{ "title": "...", "url": "...", "tag": "...", "takeaway": "..." }],
  "finance": [{ "title": "...", "url": "...", "tag": "...", "takeaway": "..." }],
  "community": [{ "title": "...", "url": "...", "tag": "...", "takeaway": "..." }]
}`;

  try {
    const { data } = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(rawSources) }
        ]
      },
      {
        timeout: 18000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        }
      }
    );

    const content = data?.choices?.[0]?.message?.content;
    return content ? JSON.parse(content) : null;
  } catch (err) {
    console.error('[DeepSeekError]:', err.response?.data || err.message);
    return null;
  }
}

/**
 * 渲染单个板块的 HTML 列表（支持 AI 提炼版与原始降级版）
 */
function renderSectionItems(items, fallbackName, limit = 3) {
  const valid = (items || []).filter((i) => i && i.title);
  if (valid.length === 0) {
    return `<i>暂无 ${escapeHtml(fallbackName)} 数据</i>`;
  }

  return valid
    .slice(0, limit)
    .map((item, idx) => {
      const title = escapeHtml(String(item.title).replace(/\s+/g, ' ').trim());
      const rawUrl = String(item.url || '').trim();
      const safeUrl = /^https?:\/\//i.test(rawUrl) ? escapeHtml(rawUrl) : '';
      const tag = item.tag ? ` <code>${escapeHtml(item.tag)}</code>` : '';

      const linkPart = safeUrl ? `<a href="${safeUrl}"><b>${title}</b></a>` : `<b>${title}</b>`;
      const takeawayText = item.takeaway
        ? escapeHtml(String(item.takeaway).replace(/\s+/g, ' ').trim())
        : '';

      return takeawayText
        ? `${idx + 1}. ${linkPart}${tag}\n   ↳ <i>${takeawayText}</i>`
        : `${idx + 1}. ${linkPart}${tag}`;
    })
    .join('\n');
}

module.exports = async (req, res) => {
  const botToken = process.env.TG_BOT_TOKEN?.trim();
  const chatId = process.env.TG_CHAT_ID?.trim();
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();

  if (!botToken || !chatId) {
    return res.status(500).json({
      success: false,
      error: '未配置 TG_BOT_TOKEN 或 TG_CHAT_ID 环境变量'
    });
  }

  const todayHeader = getBeijingDateWithWeekday();

  // 1. 并行抓取顶部状态栏 + 四大高价值信源
  const [headerBar, globalTechRaw, domesticTechRaw, financeRaw, communityRaw] =
    await Promise.all([
      fetchHeaderBar(),
      fetchGlobalTechRaw(),
      fetch36KrRaw(),
      fetchWallstreetcnRaw(),
      fetchCommunityHotRaw()
    ]);

  // 2. 使用 DeepSeek 进行去标题党、中文化与一句话总结（若未配置 Key 或超时则平滑降级）
  const curated = await curateWithDeepSeek(
    {
      globalTech: globalTechRaw,
      domesticTech: domesticTechRaw,
      finance: financeRaw,
      community: communityRaw
    },
    deepseekKey
  );

  const insightBlock = curated?.dailyInsight
    ? `<b>📌 今日核心风向（DeepSeek 提炼）</b>\n${escapeHtml(curated.dailyInsight)}`
    : null;

  const globalTechHtml = renderSectionItems(
    curated?.globalTech || globalTechRaw,
    '全球科技与开源'
  );
  const domesticTechHtml = renderSectionItems(
    curated?.domesticTech || domesticTechRaw,
    '国内科技商业'
  );
  const financeHtml = renderSectionItems(
    curated?.finance || financeRaw,
    '全球宏观与财经'
  );
  const communityHtml = renderSectionItems(
    curated?.community || communityRaw,
    '社区高赞热议'
  );

  // 3. 组装黄金结构早报
  const messageBlocks = [
    headerBar
      ? `<b>☀️ 每日早报 · ${todayHeader}</b>\n${headerBar}`
      : `<b>☀️ 每日早报 · ${todayHeader}</b>`,
    insightBlock,
    `<b>🌍 全球技术与开源先锋 (HN &amp; GitHub)</b>\n${globalTechHtml}`,
    `<b>🤖 国内科技与 AI 商业 (36氪)</b>\n${domesticTechHtml}`,
    `<b>💰 宏观与市场快讯 (华尔街见闻)</b>\n${financeHtml}`,
    `<b>🔥 行业与极客热议 (知乎 &amp; V2EX)</b>\n${communityHtml}`,
    `<i>点击标题直达原文 · 由 DeepSeek 驱动智能提炼</i>`
  ].filter(Boolean);

  const messageText = messageBlocks.join('\n\n');

  try {
    const tgTokenPath = botToken.startsWith('bot') ? botToken : `bot${botToken}`;
    const tgUrl = `https://api.telegram.org/${tgTokenPath}/sendMessage`;

    await axios.post(
      tgUrl,
      {
        chat_id: chatId,
        text: messageText,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      },
      { timeout: 10000 }
    );

    return res.status(200).json({
      success: true,
      ai_curated: Boolean(curated),
      message: 'Telegram 黄金早报推送成功！'
    });
  } catch (err) {
    const errorDetail = err.response?.data || err.message;
    console.error('[TelegramPushError]:', errorDetail);
    return res.status(500).json({
      success: false,
      error: errorDetail
    });
  }
};
