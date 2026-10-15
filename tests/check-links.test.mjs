import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// A throwaway local server with the situations the checker has to handle.
function startServer() {
  const server = http.createServer((req, res) => {
    const path = req.url;
    if (path === '/ok') return res.writeHead(200).end('ok');
    if (path === '/redirect') return res.writeHead(302, { Location: '/ok' }).end();
    if (path === '/head-405') return res.writeHead(req.method === 'HEAD' ? 405 : 200).end();
    if (path === '/gone') return res.writeHead(404).end();
    if (path === '/blocked') return res.writeHead(403).end();
    if (path === '/flaky') return res.writeHead(500).end();
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function setup(paths, previous) {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = await mkdtemp(join(tmpdir(), 'links-'));
  await writeFile(join(dir, 'opportunities.json'), JSON.stringify(paths.map((p) => ({ url: base + p }))));
  await writeFile(join(dir, 'donations.json'), '[]');
  if (previous) {
    const results = Object.fromEntries(Object.entries(previous(base)));
    await writeFile(join(dir, 'link-status.json'), JSON.stringify({ checkedAt: 'x', results }));
  }
  return { server, base, dir };
}

const env = (dir) => ({
  ...process.env,
  DATA_DIR: dir,
  TIMEOUT_MS: '2000',
  RETRY_DELAY_MS: '10',
  POLITE_DELAY_MS: '0',
  ALLOW_HTTP: '1',
});

// The real script requires https. The tests use a local http server, so they
// run the checker with that single rule relaxed through a tiny wrapper.
async function runChecker(dir) {
  const wrapper = join(dir, 'wrapper.mjs');
  const src = (await readFile(new URL('../scripts/check-links.mjs', import.meta.url), 'utf8')).replace(
    "/^https:\\/\\//.test(u)",
    '/^https?:\\/\\//.test(u)',
  );
  await writeFile(wrapper, src);
  return run('node', [wrapper], { env: env(dir) });
}

async function status(dir) {
  return JSON.parse(await readFile(join(dir, 'link-status.json'), 'utf8')).results;
}

test('good links, redirects and HEAD-405 servers are ok', async () => {
  const { server, base, dir } = await setup(['/ok', '/redirect', '/head-405']);
  await runChecker(dir);
  const r = await status(dir);
  server.close();
  for (const p of ['/ok', '/redirect', '/head-405']) assert.equal(r[base + p].status, 'ok', p);
});

test('a link that has never worked is unverified on its first failure', async () => {
  const { server, base, dir } = await setup(['/gone', '/blocked']);
  await runChecker(dir);
  const r = await status(dir);
  server.close();
  assert.equal(r[base + '/gone'].status, 'unverified');
  assert.equal(r[base + '/blocked'].status, 'unverified');
  assert.equal(r[base + '/gone'].failures, 1);
});

test('a previously ok link stays ok after one failure and turns unverified after two', async () => {
  const { server, base, dir } = await setup(['/flaky'], (b) => ({
    [b + '/flaky']: { status: 'ok', failures: 0, lastOk: '2026-01-01T00:00:00Z' },
  }));
  await runChecker(dir);
  let r = await status(dir);
  assert.equal(r[base + '/flaky'].status, 'ok');
  assert.equal(r[base + '/flaky'].failures, 1);
  await runChecker(dir);
  r = await status(dir);
  server.close();
  assert.equal(r[base + '/flaky'].status, 'unverified');
  assert.equal(r[base + '/flaky'].failures, 2);
  assert.equal(r[base + '/flaky'].lastOk, '2026-01-01T00:00:00Z');
});

test('a recovered link goes back to ok and resets failures', async () => {
  const { server, base, dir } = await setup(['/ok'], (b) => ({
    [b + '/ok']: { status: 'unverified', failures: 3, lastOk: null },
  }));
  await runChecker(dir);
  const r = await status(dir);
  server.close();
  assert.equal(r[base + '/ok'].status, 'ok');
  assert.equal(r[base + '/ok'].failures, 0);
});

test('every link in the real data files is https', async () => {
  for (const file of ['opportunities.json', 'donations.json']) {
    const items = JSON.parse(await readFile(new URL(`../data/${file}`, import.meta.url), 'utf8'));
    for (const item of items) assert.match(item.url, /^https:\/\//, `${file}: ${item.name || item.id}`);
  }
});
