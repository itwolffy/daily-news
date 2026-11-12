const axios = require('axios');

async function fetchTop3(sourceUrl, sourceName) {
  try {
    const res = await axios.get(sourceUrl, { timeout: 8000 });
    const list = res.data?.data || res.data || [];
    return list.slice(0, 3).map((item, index) => {
      const rawTitle = item.title || item.name || '未知标题';
      const title = rawTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const url = item.url || item.mobileUrl || item.link || '';
      return `${index + 1}. <a href="${url}">${title}</a>`;
    }).join('\n');
  } catch (error) {
    return `暂时无法获取 ${sourceName} 数据`;
  }
}

module.exports = async (req, res) => {
  const botToken = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;

  if (!botToken || !chatId) {
    return res.status(500).json({ error: '未配置 TG_BOT_TOKEN 或 TG_CHAT_ID 环境变量' });
  }

  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().split('T');

  const [techNews, socialNews, financeNews] = await Promise.all([
    fetchTop3('https://imsyy.top', '36氪科技'),
    fetchTop3('https://imsyy.top', '知乎热榜'),
    fetchTop3('https://imsyy.top', '华尔街见闻')
  ]);

  const messageText = `<b>☀️ 每日早报 (${today})</b>\n\n` +
    `<b>🤖 科技与 AI 资讯 (36氪)</b>\n${techNews}\n\n` +
    `<b>🔥 社会热点 (知乎热榜)</b>\n${socialNews}\n\n` +
    `<b>💰 财经与商业观察 (华尔街见闻)</b>\n${financeNews}\n\n` +
    `<i>点击标题即可直达原文 · 祝你今天心情愉快！</i>`;

  try {
    const tgUrl = `https://telegram.org{botToken}/sendMessage`;
    await axios.post(tgUrl, {
      chat_id: chatId,
      text: messageText,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    res.status(200).json({ success: true, message: 'Telegram 早报推送成功！' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
};
