const axios = require('axios');

const http = axios.create({
  timeout: Number(process.env.HTTP_TIMEOUT_MS) || 8000,
  headers: {
    'User-Agent': 'daily-news-bot/2.0 (+https://github.com/itwolffy/daily-news)',
    Accept: 'application/json, application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  }
});

module.exports = { http };
