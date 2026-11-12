const { http } = require('../utils/http');

async function fetchGitHubTrending() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const query = encodeURIComponent('pushed:>' + since + ' stars:>100');
  const { data } = await http.get(
    'https://api.github.com/search/repositories?q=' + query + '&sort=stars&order=desc&per_page=8',
    { headers: { Accept: 'application/vnd.github+json' } }
  );

  return (data?.items || []).slice(0, 5).map(repo => ({
    source: 'GitHub',
    category: 'developer',
    sourceId: String(repo.id),
    title: repo.full_name + ': ' + (repo.description || '近期活跃开源项目'),
    url: repo.html_url,
    summary: repo.description || '',
    publishedAt: repo.pushed_at || repo.created_at,
    metrics: { stars: repo.stargazers_count || 0, forks: repo.forks_count || 0 },
    meta: { language: repo.language || '', createdAt: repo.created_at }
  }));
}

module.exports = { fetchGitHubTrending };
