// ── dom.js ───────────────────────────────────────────────────────────────────
const FLASK_URL = 'https://dom';
const MAIL_DOMAIN = 'vulnlab.bo';

const userSessions = new Map();


const USERS = [
  { username: 'mariasantillana', password: '1234pavo' },
  { username: 'lusianaperez', password: '1234mesa' },
  { username: 'antoniacastillo', password: '1234famr' },
];
const https = require('https');
const url = require('url');

// Función que reemplaza el fetch con https.request
function postWithHttps(fullUrl, formData, options = {}) {
  const parsedUrl = url.parse(fullUrl);
  const postData = new URLSearchParams(formData).toString();

  const reqOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 443,
    path: parsedUrl.path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
      ...options.headers
    },
    rejectUnauthorized: false   // Para certificados autofirmados
  };

  return new Promise((resolve, reject) => {
    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        // Simular respuesta con status y text()
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          text: async () => body,
          json: async () => JSON.parse(body)
        });
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}
// ── Registro ──────────────────────────────────────────────────────────────────
async function registerDomUsers() {
  console.log('[dom] Registrando usuarios DOM...');
  for (const u of USERS) {
    const email = `${u.username}@${MAIL_DOMAIN}`;
    try {
      const res = await postWithHttps(`${FLASK_URL}/record`, {
        name: u.username,
        email: email,
        password: u.password,
        confirm: u.password,
      });

      if (res.status === 302) {
        console.log(`[dom] Registrado: ${email}`);
      } else {
        const body = await res.text();
        if (body.includes('already registered')) {
          console.log(`[dom] Ya existe: ${email}`);
        } else {
          console.warn(`[dom] Fallo al registrar ${email} (status ${res.status})`);
        }
      }
    } catch (e) {
      console.warn(`[dom] Error registrando ${email}: ${e.message}`);
    }
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function loginAndSaveSession(username, password) {
  const email = `${username}@${MAIL_DOMAIN}`;
  const res = await fetch(`${FLASK_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password }),
    redirect: 'manual',
  });

  const rawCookies = res.headers.getSetCookie?.() ?? res.headers.raw?.()['set-cookie'] ?? [];
  const cookies = {};
  for (const raw of rawCookies) {
    const [pair] = raw.split(';');
    const [name, value] = pair.trim().split('=');
    cookies[name.trim()] = value.trim();
  }

  if (!cookies['session']) {
    console.warn(`[dom] Login fallido para ${username}`);
    return;
  }

  const res2 = await fetch(`${FLASK_URL}/my-posts`, {
    headers: { 'Cookie': `session=${cookies['session']}` },
  });

  const rawCookies2 = res2.headers.getSetCookie?.() ?? res2.headers.raw?.()['set-cookie'] ?? [];
  for (const raw of rawCookies2) {
    const [pair] = raw.split(';');
    const [name, value] = pair.trim().split('=');
    cookies[name.trim()] = value.trim();
  }

  console.log(`[dom] Cookies de ${username}:`, cookies);
  userSessions.set(username, {
    session: cookies['session'],
    delete_token: cookies['delete_token'] ?? null,
    username,
    email,
    password,
    resuelto: false,
  });
  console.log(`[dom] Sesión guardada para ${username} — delete_token: ${cookies['delete_token'] ?? 'null'}`);
}

// ── Verificadores ─────────────────────────────────────────────────────────────


// ── Init ──────────────────────────────────────────────────────────────────────
async function initSessions(db) {
  await registerDomUsers();
  console.log('[dom] Iniciando login de usuarios...');
  await Promise.all(USERS.map(u => loginAndSaveSession(u.username, u.password)));
  for (const u of USERS) {
    if (!userSessions.get(u.username)?.session) {
      console.warn(`[dom] Reintentando login para ${u.username}...`);
      await loginAndSaveSession(u.username, u.password);
    }
  }
  console.log(`[dom] Sesiones listas: ${[...userSessions.keys()].join(', ')}`);
  const getFlag = (user) => new Promise((resolve) => {
    db.findOne({ category: 'dom', user }, (err, doc) => resolve(doc?.flag ?? null));
  });
  [flagMrodriguez, flagLperez, flagAgarcia] = await Promise.all([
    getFlag('mrodriguez'),
    getFlag('lperez'),
    getFlag('agarcia'),
  ]);
  if (flagLperez) await createPostForUser('lperez', flagLperez);
  if (flagAgarcia) await createPostForUser('agarcia', flagAgarcia);
  console.log('[dom] Posts de retos creados');
}

// ── visitdom ─────────────────────────────────────────────────────────────────
const puppeteer = require('puppeteer');
const { resolveUrl, getBaseUrl } = require('./utils');
const { isBanned } = require('./banned_urls');
//const { db } = require('./init_db');

async function visitDom(url, flag, sessionData) {
  const resolvedUrl = resolveUrl(url);
  console.log(`[dom] Visitando: ${resolvedUrl}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      ignoreHTTPSErrors: true,
      args: [
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-features=SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure',
      ],
    });
    const page = await browser.newPage();
    page.on('console', msg => console.log(`[browser-console] ${msg.text()}`));
    page.on('pageerror', err => console.log(`[browser-error] ${err.message}`));
    page.on('response', async (res) => {
      console.log(`[response] ${res.status()} ${res.url()}`);
    });

    // 1. Login
    console.log(`[dom] Haciendo login para ${sessionData.email}`);
    await page.goto('https://dom/login', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.type('input[name="email"]', sessionData.email);
    await page.type('input[name="password"]', sessionData.password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
      page.click('button[type="submit"]'),
    ]);
    await new Promise(r => setTimeout(r, 2000));
    console.log(`[dom] URL post-login: ${page.url()}`);
    const pageContent = await page.content();
    console.log(`[dom] Primeros 500 chars: ${pageContent.substring(0, 500)}`);
    console.log(`[dom] Login exitoso para ${sessionData.email}`);

    // 2. Guardar cookies
    const savedCookies = await page.cookies('https://dom', 'https://127.0.0.1:83');
    const sessionCookie = savedCookies.find(c => c.name === 'session');
    const cookieParts = [];
    if (sessionCookie) cookieParts.push(`session=${sessionCookie.value}`);
    cookieParts.push(`flagFlisol=${flag}`);
    const cookieHeader = cookieParts.join('; ');
    console.log(`[dom] Cookies capturadas: ${cookieHeader}`);

    

    // 4. Interceptor — chequeo de baneo en el primer request hacia dom
    await page.setRequestInterception(true);
    let basePath = null;
    let domChecked = false;

    page.on('request', async (req) => {
      const intercepted = resolveUrl(req.url());
      const extraHeaders = {};

      if (!domChecked && intercepted.includes('dom')) {
        domChecked = true;
        basePath = getBaseUrl(intercepted, 2);
        const banned = await isBanned(basePath);
        if (banned) {
          console.log(`[dom] url baneada: ${basePath}`);
          req.abort();
          return;
        }
        console.log(`[dom] url correcta: ${basePath}`);
      }

      if (intercepted.includes('dom') && cookieHeader) {
        extraHeaders['Cookie'] = cookieHeader;
        console.log(`[intercept-dom] Inyectando cookies en: ${intercepted}`);
      }

      if (intercepted !== req.url()) {
        console.log(`[intercept-dom] ${req.url()} → ${intercepted}`);
      }

      req.continue({ url: intercepted, headers: { ...req.headers(), ...extraHeaders } });
    });

    // 5. Visitar URL del atacante
    const res = await page.goto(resolvedUrl, { waitUntil: 'networkidle2', timeout: 10000 });
    console.log(`[dom] ${resolvedUrl} → ${res?.status()}`);
    await new Promise(r => setTimeout(r, 5000));
    return basePath;
  } catch (e) {
    console.warn(`[dom] Error: ${e.message}`);
  } finally {
    await browser?.close();
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  userSessions,
  initSessions,
  visitDom,
};
