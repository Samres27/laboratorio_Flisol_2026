// ── banned_urls.js ────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { getBaseUrl } = require('./utils');

const FILE = path.resolve('./data/banned_urls.txt');

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

function banUrl(url) {
  const base = normalizeUrl(getBaseUrl(url, 1));
  console.log(`[banned_urls] Baneando: ${base}`);
  fs.appendFileSync(FILE, base + '\n');
}

function isBanned(url) {
  try {
    const normalized = normalizeUrl(url);
    const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
    const banned = lines.some(base => normalized.startsWith(base));
    if (banned) console.log(`[banned_urls] Baneada: ${url}`);
    return Promise.resolve(banned);
  } catch {
    return Promise.resolve(false);
  }
}

module.exports = { banUrl, isBanned };