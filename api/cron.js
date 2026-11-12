const axios = require('axios');

// 复用 axios 实例并统一配置超时与请求头
const http = axios.create({
  timeout: 8000,
  headers: {
    'User-Agent': 'DailyBriefingBot/1.0'
  }
});

// 统一维护各资讯源配置（请確認实际子路径，例如 DailyHotApi 的 /36kr、/zhihu、/wallstreetcn）
const NEWS_SOURCES = [
  {
    key: 'tech',
    title: '🤖 科技与 AI 资讯 (36氪)',
    name: '36氪科技',
    url: process.env.API_36KR_URL || 'https://api-hot.imsyy.top/36kr'
  },
  {
    key: 'social',
    title: '🔥 社会热点 (知乎热榜)',
    name: '知乎热榜',
    url: process.env.API_ZHIHU_URL || 'https://api-hot.imsyy.top/zhihu'
  },
  {
    key: 'finance',
    title: '💰 财经与商业观察 (华尔街见闻)',
    name: '华尔街见闻',
    url: process.env.API_WALLSTREET_URL || 'https://api-hot.imsyy.top/wallstreetcn'
  }
];

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
 * 拉取指定数据源的前 N 条资讯并格式化为 Telegram HTML 列表
 */
async function fetchTopNews(sourceUrl, sourceName, limit = 3) {
  try {
    const { data } = await http.get(sourceUrl);
    const rawList = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data)
        ? data
        : [];

    if (rawList.length === 0) {
      return `<i>暂无 ${escapeHtml(sourceName)} 数据</i>`;
    }

    return rawList
      .slice(0, limit)
      .map((item, index) => {
        const title = escapeHtml(item?.title || item?.name || '未知标题');
        const rawUrl = item?.url || item?.mobileUrl || item?.link || '';
        const safeUrl = /^https?:\/\//i.test(rawUrl) ? escapeHtml(rawUrl) : '';

        return safeUrl
          ? `${index + 1}. <a href="${safeUrl}">${title}</a>`
          : `${index + 1}. ${title}`;
      })
      .join('\n');
  } catch (error) {
    console.error(`[FetchError] ${sourceName} (${sourceUrl}):`, error.message);
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

  // 并行拉取所有资讯源
  const sections = await Promise.all(
    NEWS_SOURCES.map(async (source) => {
      const content = await fetchTopNews(source.url, source.name, 3);
      return `<b>${source.title}</b>\n${content}`;
    })
  );

  const messageText = [
    `<b>☀️ 每日早报 (${today})</b>`,
    ...sections,
    `<i>点击标题即可直达原文 · 祝你今天心情愉快！</i>`
  ].join('\n\n');

  try {
    // 修复 Telegram Bot API 路径：需包含 /bot 前缀
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
