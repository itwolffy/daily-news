const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFeed, decodeXml } = require('../src/collectors/rss');
const { createCollectorRegistry } = require('../src/collectors');

const feed = { name: 'Test Feed', category: 'aiTech' };

test('RSS parser reads item fields, CDATA and XML entities', () => {
  const xml = `<?xml version="1.0"?>
    <rss><channel><item>
      <title><![CDATA[AI &amp; software]]></title>
      <guid>item-1</guid>
      <link>https://example.com/story?x=1&amp;y=2</link>
      <description><![CDATA[<p>Long summary</p>]]></description>
      <pubDate>Mon, 16 Nov 2026 08:00:00 GMT</pubDate>
    </item></channel></rss>`;
  const [item] = parseFeed(xml, feed);
  assert.equal(item.title, 'AI & software');
  assert.equal(item.sourceId, 'item-1');
  assert.equal(item.url, 'https://example.com/story?x=1&y=2');
  assert.equal(item.summary, 'Long summary');
  assert.equal(item.publishedAt, 'Mon, 16 Nov 2026 08:00:00 GMT');
});

test('Atom parser prefers alternate href and supports namespaced summary', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
    <entry>
      <id>tag:example.com,2026:story-2</id>
      <title>Atom story</title>
      <link rel="self" href="https://example.com/api/story-2" />
      <link rel="alternate" type="text/html" href="https://example.com/story-2" />
      <updated>2026-11-16T08:00:00Z</updated>
      <content:encoded><![CDATA[<p>Atom summary</p>]]></content:encoded>
    </entry>
  </feed>`;
  const [item] = parseFeed(xml, feed);
  assert.equal(item.sourceId, 'tag:example.com,2026:story-2');
  assert.equal(item.url, 'https://example.com/story-2');
  assert.equal(item.summary, 'Atom summary');
  assert.equal(item.publishedAt, '2026-11-16T08:00:00Z');
});

test('XML decoder handles hexadecimal numeric entities', () => {
  assert.equal(decodeXml('&#x1F680; &#169;'), '🚀 ©');
});

test('collector registry runs registered collectors concurrently and isolates failures', async () => {
  const registry = createCollectorRegistry([
    { name: 'good', collect: async () => [{ title: 'one' }] },
    { name: 'bad', collect: async () => { throw new Error('upstream down'); } },
    { name: 'invalid-shape', collect: async () => ({ items: [] }) }
  ]);
  const result = await registry.collectAll();
  assert.deepEqual(registry.list(), ['good', 'bad', 'invalid-shape']);
  assert.deepEqual(result.items, [{ title: 'one' }]);
  assert.deepEqual(result.stats, [
    { source: 'good', count: 1, ok: true },
    { source: 'bad', count: 0, ok: false },
    { source: 'invalid-shape', count: 0, ok: true }
  ]);
});

test('collector registry rejects duplicate names and invalid definitions', () => {
  assert.throws(() => createCollectorRegistry([
    { name: 'same', collect: async () => [] },
    { name: 'same', collect: async () => [] }
  ]), /Duplicate collector name/);
  assert.throws(() => createCollectorRegistry([{ name: 'missing function' }]), /collect function/);
});
