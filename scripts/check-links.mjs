#!/usr/bin/env node
// Checks every link in data/opportunities.json and data/donations.json and
// writes data/link-status.json. No dependencies. Needs Node 18+.
//
// Rules (so one flaky day doesn't mislabel a good link):
//   - A link that loads is "ok".
//   - A link that fails once keeps its previous status, or is "unverified" if it was never "ok".
//   - A link that fails twice in a row is "unverified".
// The app never hides a link. It only shows an "Unverified" marker.
// This only proves a page loads. It can't tell whether the content is still right.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DATA_DIR = process.env.DATA_DIR || 'data';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS || 2000);
const POLITE_DELAY_MS = Number(process.env.POLITE_DELAY_MS || 500);
const repo = process.env.GITHUB_REPOSITORY;
const UA = `giving-app-link-checker/1.0${repo ? ` (+https://github.com/${repo})` : ''}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, file), 'utf8'));
  } catch (err) {
    if (fallback !== undefined && err.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
}

async function request(url, method) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8' },
    });
    if (method === 'GET') await res.body?.cancel();
    return { status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function attempt(url) {
  try {
    let { status } = await request(url, 'HEAD');
    // Many sites reject HEAD or bots on HEAD. Fall back to GET before giving up.
    if (status >= 400) ({ status } = await request(url, 'GET'));
    return status >= 200 && status < 400
      ? { ok: true, status }
      : { ok: false, status, note: `HTTP ${status}` };
  } catch (err) {
    try {
      const { status } = await request(url, 'GET');
      return status >= 200 && status < 400
        ? { ok: true, status }
        : { ok: false, status, note: `HTTP ${status}` };
    } catch (err2) {
      const reason = err2.name === 'AbortError' ? 'timeout' : err2.cause?.code || err2.message;
      return { ok: false, note: String(reason) };
    }
  }
}

async function checkOne(url) {
  let result = await attempt(url);
  if (!result.ok) {
    await sleep(RETRY_DELAY_MS);
    result = await attempt(url);
  }
  return result;
}

async function main() {
  const [opps, donations, previous] = await Promise.all([
    readJson('opportunities.json'),
    readJson('donations.json'),
    readJson('link-status.json', { checkedAt: null, results: {} }),
  ]);

  const urls = [...new Set([...opps, ...donations].map((x) => x.url).filter(Boolean))];
  const bad = urls.filter((u) => !/^https:\/\//.test(u));
  if (bad.length) throw new Error(`These links aren't https:\n${bad.join('\n')}`);

  const now = new Date().toISOString();
  const results = {};

  for (const url of urls) {
    const prev = previous.results?.[url];
    const r = await checkOne(url);
    if (r.ok) {
      results[url] = { status: 'ok', failures: 0, checkedAt: now, lastOk: now, httpStatus: r.status };
    } else {
      const failures = (prev?.failures || 0) + 1;
      const status = failures >= 2 || prev?.status !== 'ok' ? 'unverified' : 'ok';
      results[url] = {
        status,
        failures,
        checkedAt: now,
        lastOk: prev?.lastOk || null,
        note: r.note,
      };
    }
    await sleep(POLITE_DELAY_MS);
  }

  const sorted = Object.fromEntries(Object.entries(results).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(
    join(DATA_DIR, 'link-status.json'),
    JSON.stringify({ checkedAt: now, results: sorted }, null, 2) + '\n',
  );

  const lines = Object.entries(sorted).map(
    ([u, r]) => `${r.status === 'ok' ? 'ok        ' : 'UNVERIFIED'}  ${u}${r.note ? `  (${r.note})` : ''}`,
  );
  const summary = `${lines.join('\n')}\n\n${urls.length} links checked, ${
    Object.values(sorted).filter((r) => r.status !== 'ok').length
  } unverified.`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, '```\n' + summary + '\n```\n', { flag: 'a' });
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
