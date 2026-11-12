const axios = require('axios');

// 复用 axios 实例并配置模拟浏览器请求头（避免被官方接口 403 拦截）
const http = axios.create({
  timeout: 12000,
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
 * 获取北京时间日期字符串 (YYYY-MM-DD)
 */
function getBeijingDate() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/**
 * 将抓取到的 { title, url } 数组格式化为 Telegram HTML 列表
 */
function formatItems(items, sourceName, limit = 3) {
  const validItems = (items || []).filter((item) => item && item.title);
  if (validItems.length === 0) {
    return `<i>暂无 ${escapeHtml(sourceName)} 数据</i>`;
  }

  return validItems
    .slice(0, limit)
    .map((item, index) => {
      const cleanTitle = escapeHtml(String(item.title).replace(/\s+/g, ' ').trim());
      const rawUrl = String(item.url || '').trim();
      const safeUrl = /^https?:\/\//i.test(rawUrl) ? escapeHtml(rawUrl) : '';

      return safeUrl
        ? `${index + 1}. <a href="${safeUrl}">${cleanTitle}</a>`
        : `${index + 1}. ${cleanTitle}`;
    })
    .join('\n');
}

/**
 * 通用解析第三方聚合接口 (如自建 DailyHotApi)
 */
async function fetchFromCustomAggregator(url) {
  const { data } = await http.get(url);
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return list.map((item) => ({
    title: item?.title || item?.name,
    url: item?.url || item?.mobileUrl || item?.link
  }));
}

/**
 * 1. 获取 36氪热榜（直连官方网关接口，无需第三方中转）
 */
async function fetch36Kr(limit = 3) {
  const sourceName = '36氪科技';
  try {
    if (process.env.API_36KR_URL) {
      const items = await fetchFromCustomAggregator(process.env.API_36KR_URL);
      return formatItems(items, sourceName, limit);
    }

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

    const list =
      data?.data?.hotRankList ||
      data?.data?.data ||
      data?.hotRankList ||
      [];

    const items = list.map((entry) => {
      const mat = entry?.templateMaterial || entry;
      const id = entry?.itemId || mat?.itemId || entry?.id;
      return {
        title: mat?.widgetTitle || entry?.title || entry?.name,
        url: entry?.url || (id ? `https://36kr.com/p/${id}` : 'https://36kr.com/hot-list/catalog')
      };
    });

    return formatItems(items, sourceName, limit);
  } catch (error) {
    console.error(`[FetchError] ${sourceName}:`, error.message);
    return `<i>暂时无法获取 ${escapeHtml(sourceName)} 数据</i>`;
  }
}

/**
 * 2. 获取 知乎热榜（直连知乎官方免登录热榜接口）
 */
async function fetchZhihu(limit = 3) {
  const sourceName = '知乎热榜';
  try {
    if (process.env.API_ZHIHU_URL) {
      const items = await fetchFromCustomAggregator(process.env.API_ZHIHU_URL);
      return formatItems(items, sourceName, limit);
    }

    const { data } = await http.get(
      'https://api.zhihu.com/topstory/hot-list?limit=10&reverse_order=0',
      {
        headers: {
          Referer: 'https://www.zhihu.com/hot'
        }
      }
    );

    const list = Array.isArray(data?.data) ? data.data : [];
    const items = list.map((entry) => {
      const target = entry?.target || entry;
      const questionId = target?.id;
      const rawUrl = target?.url || entry?.url || '';
      const webUrl = questionId
        ? `https://www.zhihu.com/question/${questionId}`
        : rawUrl.replace('api.zhihu.com/questions/', 'www.zhihu.com/question/');

      return {
        title: target?.title || entry?.title,
        url: webUrl
      };
    });

    return formatItems(items, sourceName, limit);
  } catch (error) {
    console.error(`[FetchError] ${sourceName}:`, error.message);
    return `<i>暂时无法获取 ${escapeHtml(sourceName)} 数据</i>`;
  }
}

/**
 * 3. 获取 华尔街见闻快讯（直连华尔街见闻官方接口）
 */
async function fetchWallstreetcn(limit = 3) {
  const sourceName = '华尔街见闻';
  try {
    if (process.env.API_WALLSTREET_URL) {
      const items = await fetchFromCustomAggregator(process.env.API_WALLSTREET_URL);
      return formatItems(items, sourceName, limit);
    }

    const { data } = await http.get(
      'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=10',
      {
        headers: {
          Referer: 'https://wallstreetcn.com/'
        }
      }
    );

    const list = Array.isArray(data?.data?.items) ? data.data.items : [];
    const items = list.map((entry) => {
      const rawText = (
        entry?.title ||
        entry?.content_text ||
        (entry?.content || '').replace(/<[^>]+>/g, '')
      ).trim();

      const title = rawText.length > 75 ? `${rawText.slice(0, 75)}...` : rawText;
      const url =
        entry?.uri ||
        (entry?.id ? `https://wallstreetcn.com/livenews/${entry.id}` : 'https://wallstreetcn.com/live/global');

      return { title, url };
    });

    return formatItems(items, sourceName, limit);
  } catch (error) {
    console.error(`[FetchError] ${sourceName}:`, error.message);
    return `<i>暂时无法获取 ${escapeHtml(sourceName)} 数据</i>`;
  }
}

module.exports = async (req, res) => {
  const botToken = process.env.TG_BOT_TOKEN?.trim();
  const chatId = process.env.TG_CHAT_ID?.trim();

  if (!botToken || !chatId) {
    return res.status(500).json({
      success: false,
      error: '未配置 TG_BOT_TOKEN 或 TG_CHAT_ID 环境变量'
    });
  }

  const today = getBeijingDate();

  // 并行直连三个平台官方热榜接口
  const [techNews, socialNews, financeNews] = await Promise.all([
    fetch36Kr(3),
    fetchZhihu(3),
    fetchWallstreetcn(3)
  ]);

  const messageText = [
    `<b>☀️ 每日早报 (${today})</b>`,
    `<b>🤖 科技与 AI 资讯 (36氪)</b>\n${techNews}`,
    `<b>🔥 社会热点 (知乎热榜)</b>\n${socialNews}`,
    `<b>💰 财经与商业观察 (华尔街见闻)</b>\n${financeNews}`,
    `<i>点击标题即可直达原文 · 祝你今天心情愉快！</i>`
  ].join('\n\n');

  try {
    const tgTokenPath = botToken.startsWith('bot') ? botToken : `bot${botToken}`;
    const tgUrl = `https://api.telegram.org/${tgTokenPath}/sendMessage`;

    await http.post(tgUrl, {
      chat_id: chatId,
      text: messageText,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    return res.status(200).json({
      success: true,
      message: 'Telegram 早报推送成功！'
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
