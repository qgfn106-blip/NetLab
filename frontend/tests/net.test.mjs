import test from 'node:test';
import assert from 'node:assert/strict';

test('plotkitFrameUrl 不携带 token 片段，只带普通查询参数', async () => {
  const { plotkitFrameUrl } = await import('../app/net.js');
  assert.equal(plotkitFrameUrl(''), '/plotkit/');
  assert.equal(plotkitFrameUrl({ a: '1' }), '/plotkit/?a=1');
  assert.ok(!plotkitFrameUrl({ a: '1' }).includes('token'));
  assert.ok(!plotkitFrameUrl({ a: '1' }).includes('#'));
});

test('api 自动加 Content-Type，并解析 JSON', async () => {
  const { api } = await import('../app/net.js');
  let seen = null;
  globalThis.fetch = async (path, config) => {
    seen = { path, config };
    return { ok: true, status: 200, text: async () => '{"ok":true}' };
  };
  const out = await api('/api/x');
  assert.deepEqual(out, { ok: true });
  assert.equal(seen.path, '/api/x');
  assert.equal(seen.config.headers['Content-Type'], 'application/json');
});

test('api 把 403 token 错误翻译成桌面提示', async () => {
  const { api } = await import('../app/net.js');
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    text: async () => '{"detail":"桌面会话 token 无效"}',
  });
  await assert.rejects(() => api('/api/x'), /桌面会话 token 无效/);
});

test('api 对无法解析的响应体报 HTTP 状态', async () => {
  const { api } = await import('../app/net.js');
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>' });
  await assert.rejects(() => api('/api/x'), /无法解析的数据（HTTP 200）/);
});

test('api 超时转换为可读错误', async () => {
  const { api } = await import('../app/net.js');
  globalThis.fetch = (path, config) =>
    new Promise((resolve, reject) => {
      config.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  await assert.rejects(() => api('/api/x', { timeoutMs: 10 }), /请求超时/);
});

test('token 从 URL 读取后会从地址栏移除，并进入请求头', async () => {
  let replaced = null;
  globalThis.window = {
    location: { search: '?token=abc&x=1', pathname: '/', hash: '#h' },
    history: { replaceState: (_s, _t, url) => { replaced = url; } },
  };
  const mod = await import('../app/net.js?token=abc');
  assert.equal(mod.DESKTOP_TOKEN, 'abc');
  assert.equal(replaced, '/?x=1#h');
  let seen = null;
  globalThis.fetch = async (path, config) => {
    seen = config;
    return { ok: true, status: 200, text: async () => '' };
  };
  await mod.api('/api/y');
  assert.equal(seen.headers['X-Netlab-Token'], 'abc');
});
