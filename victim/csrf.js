// ── csrf.js ───────────────────────────────────────────────────────────────────
const FLASK_URL = 'http://csrf';

const userSessions = new Map();

const USERS = [
  { username: 'mrodriguez', password: 'pollo1234' },
  { username: 'lperez', password: 'casa1234' },
  { username: 'agarcia', password: 'prado1234' },
];

// ── Login ─────────────────────────────────────────────────────────────────────
async function loginAndSaveSession(username, password) {
  const res = await fetch(`${FLASK_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
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
    console.warn(`[csrf] Login fallido para ${username}`);
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

  console.log(`[csrf] Cookies de ${username}:`, cookies);
  userSessions.set(username, {
    session: cookies['session'],
    delete_token: cookies['delete_token'] ?? null,
    username,
    password,
    resuelto: false,
  });
  console.log(`[csrf] Sesión guardada para ${username} — delete_token: ${cookies['delete_token'] ?? 'null'}`);
}

// ── CSRF token ────────────────────────────────────────────────────────────────
async function getCsrfToken(username) {
  const userData = userSessions.get(username);
  if (!userData?.session) return '';
  const res = await fetch(`${FLASK_URL}/post/create`, {
    headers: { 'Cookie': `session=${userData.session}` },
  });
  const html = await res.text();
  const match = html.match(/name="csrf_token"\s+value="([^"]+)"/);
  return match ? match[1] : '';
}

// ── Crear post ────────────────────────────────────────────────────────────────
async function createPostForUser(username, flag, publishe = 0) {
  const userData = userSessions.get(username);
  if (!userData?.session) {
    console.warn(`[csrf] Sin sesión para ${username}, no se puede crear post`);
    return;
  }
  const csrfToken = await getCsrfToken(username);
  if (!csrfToken) {
    console.warn(`[csrf] No se pudo obtener csrf_token para ${username}`);
    return;
  }
  const res = await fetch(`${FLASK_URL}/post/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `session=${userData.session}`,
    },
    body: new URLSearchParams({
      title: `Post secreto de ${username}`,
      body: flag,
      csrf_token: csrfToken,
      published: publishe,
    }),
    redirect: 'manual',
  });
  console.log(`[csrf] Post created para ${username} → HTTP ${res.status}`);
}

// ── Verificadores ─────────────────────────────────────────────────────────────
async function verifyDelete(flag, user) {
  let userData = userSessions.get(user);
  console.log("[verifyDelete] user:" + user + " flag:" + flag);
  if (!userData?.session) {
    console.warn(`[verifyDelete] Sin sesión para ${user}, reintentando...`);
    const u = USERS.find(u => u.username === user);
    if (u) await loginAndSaveSession(u.username, u.password);
    userData = userSessions.get(user);
    if (!userData?.session) return false;
  }
  const res = await fetch(`${FLASK_URL}/my-posts`, {
    headers: { 'Cookie': `session=${userData.session}` },
  });
  const html = await res.text();
  console.log(`[verifyDelete] ¿flag en my-posts?: ${html.includes(flag)}`);
  if (!userData.resuelto && !html.includes(flag)) {
    console.log("[verifyDelete] Resuelto: " + user);
    userSessions.set(user, { ...userData, resuelto: true });
    await createPostForUser(user, flag, 1);
    return true;
  }
  console.log("[verifyDelete] Sin resolver: " + user);
  return false;
}

async function verifyCreate(flag) {
  const userData = userSessions.get('mrodriguez');
  console.log("[verifyCreate]: revisando sesion");
  if (!userData?.session) {
    console.warn('[verifyCreate]: sin sesión, reintentando login...');
    await loginAndSaveSession('mrodriguez', 'pollo1234');
    const retried = userSessions.get('mrodriguez');
    if (!retried?.session) return false;
  }
  const fresh = userSessions.get('mrodriguez');
  const res = await fetch(`${FLASK_URL}/my-posts`, {
    headers: { 'Cookie': `session=${fresh.session}` },
  });
  console.log("[verifyCreate]: revisando sitio");
  const html = await res.text();
  if (!fresh.resuelto && html.includes('created:')) {
    console.log("[verifyCreate]: Resuelto");
    userSessions.set("mrodriguez", { ...fresh, resuelto: true });
    await createPostForUser('mrodriguez', flag, 1);
    return true;
  }
  console.log("[verifyCreate]: sin resolver");
  return false;
}

async function verifyCsrfChallenge(user, flag) {
  console.log("verificando reto para: " + user + " flag:" + flag);
  switch (user) {
    case 'lperez':
    case 'agarcia': return await verifyDelete(flag, user);
    case 'mrodriguez': return await verifyCreate(flag);
    default: return true;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function initSessions(db) {
  console.log('[csrf] Iniciando login de usuarios...');
  await Promise.all(USERS.map(u => loginAndSaveSession(u.username, u.password)));
  for (const u of USERS) {
    if (!userSessions.get(u.username)?.session) {
      console.warn(`[csrf] Reintentando login para ${u.username}...`);
      await loginAndSaveSession(u.username, u.password);
    }
  }
  console.log(`[csrf] Sesiones listas: ${[...userSessions.keys()].join(', ')}`);
  const getFlag = (user) => new Promise((resolve) => {
    db.findOne({ category: 'csrf', user }, (err, doc) => resolve(doc?.flag ?? null));
  });
  [flagMrodriguez, flagLperez, flagAgarcia] = await Promise.all([
    getFlag('mrodriguez'),
    getFlag('lperez'),
    getFlag('agarcia'),
  ]);
  if (flagLperez) await createPostForUser('lperez', flagLperez);
  if (flagAgarcia) await createPostForUser('agarcia', flagAgarcia);
  console.log('[csrf] Posts de retos creados');
}

// ── visitCsrf ─────────────────────────────────────────────────────────────────
const puppeteer = require('puppeteer');
const { resolveUrl, getBaseUrl } = require('./utils');
const { isBanned } = require('./banned_urls');
const { db } = require('./init_db');

async function visitCsrf(url, flag, sessionData) {
  const resolvedUrl = resolveUrl(url);
  console.log(`[csrf] Visitando: ${resolvedUrl}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox',
        '--disable-features=SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure'],
    });
    const page = await browser.newPage();

    // 1. Login
    console.log(`[csrf] Haciendo login para ${sessionData.username}`);
    await page.goto('http://csrf/login', { waitUntil: 'networkidle2', timeout: 10000 });
    await page.type('input[name="username"]', sessionData.username);
    await page.type('input[name="password"]', sessionData.password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
      page.click('button[type="submit"]'),
    ]);
    console.log(`[csrf] Login exitoso para ${sessionData.username}`);

    // 2. Visitar my-posts para generar delete_token
    await page.goto('http://csrf/my-posts', { waitUntil: 'networkidle2', timeout: 10000 });
    console.log(`[csrf] delete_token generado para ${sessionData.username}`);

    // 3. Guardar cookies
    const savedCookies = await page.cookies('http://csrf');
    const sessionCookie = savedCookies.find(c => c.name === 'session');
    const deleteTokenCookie = savedCookies.find(c => c.name === 'delete_token');
    const cookieParts = [];
    if (sessionCookie) cookieParts.push(`session=${sessionCookie.value}`);
    if (deleteTokenCookie) cookieParts.push(`delete_token=${deleteTokenCookie.value}`);
    const cookieHeader = cookieParts.join('; ');
    console.log(`[csrf] Cookies capturadas: ${cookieHeader}`);

    // 4. Setear flagFlisol
    await page.setCookie({
      name: 'flagFlisol', value: flag,
      domain: 'csrf', path: '/', secure: false,
    });

    // 5. Interceptor — chequeo de baneo en el primer request hacia csrf
    await page.setRequestInterception(true);
    let basePath = null;
    let csrfChecked = false;

    page.on('request', async (req) => {
      const intercepted = resolveUrl(req.url());
      const extraHeaders = {};

      // Primer request que apunta a csrf → chequear baneo
      if (!csrfChecked && intercepted.includes('csrf')) {
        csrfChecked = true;
        basePath = getBaseUrl(intercepted, 2);
        const banned = await isBanned(basePath);
        if (banned) {
          console.log(`[csrf] url baneada: ${basePath}`);
          req.abort();
          return;
        }
        console.log(`[csrf] url correcta: ${basePath}`);
      }

      if (intercepted.includes('csrf') && cookieHeader) {
        extraHeaders['Cookie'] = cookieHeader;
        console.log(`[intercept-csrf] Inyectando cookies en: ${intercepted}`);
      }

      if (intercepted !== req.url()) {
        console.log(`[intercept-csrf] ${req.url()} → ${intercepted}`);
      }

      req.continue({ url: intercepted, headers: { ...req.headers(), ...extraHeaders } });
    });

    // 6. Visitar URL del atacante
    const res = await page.goto(resolvedUrl, { waitUntil: 'networkidle2', timeout: 10000 });
    console.log(`[csrf] ${resolvedUrl} → ${res?.status()}`);
    await new Promise(r => setTimeout(r, 5000));
    return basePath;
  } catch (e) {
    console.warn(`[csrf] Error: ${e.message}`);
  } finally {
    await browser?.close();
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  userSessions,
  initSessions,
  verifyCsrfChallenge,
  visitCsrf,
};
