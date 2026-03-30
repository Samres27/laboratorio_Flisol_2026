
const { resolveUrl } = require('./utils');
const puppeteer = require('puppeteer');
 
async function visitXss(url, flag) {
  const resolvedUrl = resolveUrl(url);
  console.log(`[xss] Visitando: ${resolvedUrl}`);
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
 
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const intercepted = resolveUrl(req.url());
      if (intercepted !== req.url()) {
        console.log(`[intercept] ${req.url()} → ${intercepted}`);
      }
      req.continue({ url: intercepted });
    });
 
    await page.setExtraHTTPHeaders({ 'X-Flag': flag });
 
    // 1. Activar dominio xss primero para poder setear la cookie
    await page.goto('http://xss', { waitUntil: 'domcontentloaded', timeout: 10000 });
 
    // 2. Setear cookie con dominio xss activo
    await page.setCookie({
      name: 'flagFlisol', value: flag,
      domain: 'xss',
      path: '/', secure: false,
    });
    console.log(`[xss] cookie seteada en dominio: xss → ${flag}`);
 
    // 3. Visitar la URL del atacante — si hace redirect a xss, la cookie ya está
    const res = await page.goto(resolvedUrl, { waitUntil: 'networkidle2', timeout: 10000 });
    console.log(`[xss] ${resolvedUrl} → ${res?.status()}`);
 
    await new Promise(r => setTimeout(r, 5000));
  } catch (e) {
    console.warn(`[xss] Error: ${e.message}`);
  } finally {
    await browser?.close();
  }
}
 
module.exports = { visitXss };