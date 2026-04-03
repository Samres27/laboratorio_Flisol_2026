// ── bot_1.js ──────────────────────────────────────────────────────────────────
const puppeteer = require('puppeteer');

const INTERNAL = 'http://127.0.0.1:8081';
const TARGET_URL = process.env.TARGET_URL || 'http://xss';
const VISIT_INTERVAL = parseFloat(process.env.VISIT_INTERVAL || '0.6') * 1000;

const PAGES = ['/noexiste'];

let FLAG_VALUE = null;

// ── Obtener flag desde internal.js ────────────────────────────────────────────
async function loadFlag(retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${INTERNAL}/internal/flag/xss/5`);
      const data = await res.json();
      if (data.flag) return data.flag;
    } catch (e) {
      console.warn(`[bot_1] Esperando internal... (${i + 1}/${retries})`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('No se pudo obtener la flag de internal');
}

async function visit(page, url) {
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });
    const status = response ? response.status() : null;
    console.log(`[bot_1] ${url} → ${status}`);
    await new Promise(r => setTimeout(r, status === 200 ? 5000 : 1000));
  } catch (e) {
    console.log(`[bot_1] Error visiting ${url}: ${e.message}`);
  }
}

async function main() {
  FLAG_VALUE = await loadFlag();
  console.log('[bot_1] Flag cargada, iniciando loop...');

  const url = new URL(TARGET_URL);

  while (true) {
    try {
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();

      await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });

      for (const domain of ['flask', 'haproxy', 'localhost', 'xss']) {
        await page.setCookie({
          name: 'flagFlisol',
          value: FLAG_VALUE,
          domain,
          path: '/',
        });
      }

      for (const path of PAGES) {
        await visit(page, TARGET_URL + path);
        await new Promise(r => setTimeout(r, VISIT_INTERVAL));
      }

      await browser.close();
    } catch (e) {
      console.log(`[bot_1] Cycle error: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, VISIT_INTERVAL));
  }
}

main();
