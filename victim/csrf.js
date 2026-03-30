// ── csrf.js ─────────────────────────────────────────────────────────────────
// Módulo que maneja sesiones, setup de posts y verificación de retos CSRF

const FLASK_URL = 'http://csrf';

const userSessions = new Map();
// { username: { session, delete_token } }

const USERS = [
  { username: 'mrodriguez', password: 'pollo1234' },
  { username: 'lperez', password: 'casa1234' },
  { username: 'agarcia', password: 'prado1234' },
  
];
var flagMrodriguez
var flagLperez
var flagAgarcia



// ── Login ────────────────────────────────────────────────────────────────────

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

  // ── Visitar my-posts para forzar generación de delete_token ───
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
    session:      cookies['session'],
    delete_token: cookies['delete_token'] ?? null,
    username,
    password,
    resuelto: false,
  });

  console.log(`[csrf] Sesión guardada para ${username} — delete_token: ${cookies['delete_token'] ?? 'null'}`);
}

// ── CSRF token ───────────────────────────────────────────────────────────────

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

// ── Crear post con la flag en el body ────────────────────────────────────────

async function createPostForUser(username, flag,publishe=0) {
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
      body: flag,   // la flag va en el contenido del post
      csrf_token: csrfToken,
      published: publishe
    }),
    redirect: 'manual',
  });

  console.log(`[csrf] Post created para ${username} → HTTP ${res.status}`);
}

// ── Verificadores ────────────────────────────────────────────────────────────

// lperez  → delete: el post con la flag NO debe aparecer en /my-posts
async function verifyDelete(flag,user) {
  let userData = userSessions.get(user);
  if (!userData?.session) return false;

  let res = await fetch(`${FLASK_URL}/my-posts`, {
    headers: { 'Cookie': `session=${userData.session}` },
  });
  let html = await res.text();
  if (!userData.resuelto && !html.includes(flag)){
    console.log("resuelto "+ user)
    userSessions.set(user, { ...userData, resuelto:true });
    createPostForUser(user, flagLperez,1)
    return true;
  }else{
    console.log("sin resolver"+user)
    
  }
}


// mrodriguez → create: un post con la flag como título en /feed público
async function verifyCreate(flag) {
  const userData = userSessions.get('mrodriguez');
  if (!userData?.session) return false;

  const res = await fetch(`${FLASK_URL}/my-posts`, {
    headers: { 'Cookie': `session=${userData.session}` },
  });
  const html = await res.text();
  
  if (!userData.resuelto && html.includes('created:')){
    console.log("Resuelto")
    const existing = userSessions.get("mrodriguez") || {};
    userSessions.set("mrodriguez", { ...existing, resuelto:true });
    createPostForUser('mrodriguez', flagMrodriguez,1)
  }else{
    console.log("sin resolver")
    return false
  }
}

// ── Verificador unificado ────────────────────────────────────────────────────

async function verifyCsrfChallenge(user, flag) {
  switch (user) {
    case 'lperez':
    case 'agarcia': return await verifyDelete(flag,user) ;
    case 'mrodriguez': return await verifyCreate(flag);
    default: return true; // reto sin verificación especial
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
// db se pasa desde server.js para consultar las flags de retos.db

async function initSessions(db) {
  console.log('[csrf] Iniciando login de usuarios...');
  await Promise.all(USERS.map(u => loginAndSaveSession(u.username, u.password)));
  console.log(`[csrf] Sesiones listas: ${[...userSessions.keys()].join(', ')}`);

  // Obtener flags desde retos.db y crear los posts
  const getFlag = (user) => new Promise((resolve) => {
    db.findOne({ category: 'csrf', user }, (err, doc) => resolve(doc?.flag ?? null));
  });

  // const [flagmrodriguez , flagLperez, flagAgarcia] = await Promise.all([
  //   getFlag('lperez'),
  //   getFlag('agarcia'),
  // ]);

  [flagMrodriguez , flagLperez, flagAgarcia] = await Promise.all([
    getFlag('mrodriguez'),
    getFlag('lperez'),
    getFlag('agarcia'),
  ]);
  if (flagLperez) await createPostForUser('lperez', flagLperez);
  if (flagAgarcia) await createPostForUser('agarcia', flagAgarcia);

  console.log('[csrf] Posts de retos createds');
}

// ── visitCsrf — wrapper para bot.js ──────────────────────────────────────────
const puppeteer = require('puppeteer');

const { resolveUrl } = require('./utils');

// async function visitCsrf(url, flag, sessionData) {
//   const resolvedUrl = resolveUrl(url);
//   console.log(`[csrf] Visitando: ${resolvedUrl}`);
//   let browser;
//   try {
//     const extraHeaders = {};
//     browser = await puppeteer.launch({
//       headless: 'new',
//       args: ['--no-sandbox', '--disable-setuid-sandbox',
//         '--disable-features=SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure'],
//     });
//     const page = await browser.newPage();
//     const saved = userSessions.get(sessionData?.username);
//     // Interceptar requests internas (payloads CSRF)
//     const cookieParts = [`session=${sessionData.session}`];
//         if (sessionData.delete_token) {
//             cookieParts.push(`delete_token=${sessionData.delete_token}`);
//         }
//         extraHeaders['Cookie'] = cookieParts.join('; ');
//         console.log(`[victim] Inyectando cookies en request a csrf`);
//     await page.setRequestInterception(true);
//     page.on('request', (req) => {
//       const intercepted = resolveUrl(req.url());
//       if (intercepted !== req.url()) {
//         console.log(`[intercept-csrf] ${req.url()} → ${intercepted}`);
//       }
      
//       req.continue({ url: intercepted, headers: { ...req.headers(), ...extraHeaders } });
//     });

    
//     if (saved?.session) {
//       for (const domain of ['csrf', 'localhost', '127.0.0.1']) {
//         await page.setCookie({ name: 'session', value: saved.session, domain, path: '/', secure: false, sameSite: 'Lax' });
//         await page.setCookie({ name: 'flagFlisol', value: flag, domain, path: '/', secure: false, sameSite: 'Lax' });
//       }
//     }
//      // 1. Activar dominio xss primero para poder setear la cookie
//     await page.goto('http://csrf', { waitUntil: 'domcontentloaded', timeout: 10000 });
 
//     // 2. Setear cookie con dominio xss activo
//     await page.setCookie({
//       name: 'flagFlisol', value: flag,
//       domain: 'csrf',
//       path: '/', secure: false,
//     });
//     console.log(`[victim] cookie seteada en dominio: csrf → ${extraHeaders}`);
    
//     // 3. Visitar la URL del atacante — si hace redirect a xss, la cookie ya está

//     const res = await page.goto(resolvedUrl, { waitUntil: 'networkidle2', timeout: 10000 });
//     console.log(`[csrf] ${resolvedUrl} → ${res?.status()}`);
//     await new Promise(r => setTimeout(r, 5000));
//   } catch (e) {
//     console.warn(`[csrf] Error: ${e.message}`);
//   } finally {
//     await browser?.close();
//   }
// }


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

    // 1. Login directo con Puppeteer
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

    // 3. Guardar cookies ANTES de activar el interceptor
    const savedCookies = await page.cookies('http://csrf');
    const sessionCookie    = savedCookies.find(c => c.name === 'session');
    const deleteTokenCookie = savedCookies.find(c => c.name === 'delete_token');

    const cookieParts = [];
    if (sessionCookie)     cookieParts.push(`session=${sessionCookie.value}`);
    if (deleteTokenCookie) cookieParts.push(`delete_token=${deleteTokenCookie.value}`);
    const cookieHeader = cookieParts.join('; ');
    console.log(`[csrf] Cookies capturadas: ${cookieHeader}`);

    // 4. Setear flagFlisol en dominio csrf
    await page.setCookie({
      name: 'flagFlisol', value: flag,
      domain: 'csrf', path: '/', secure: false,
    });

    // 5. Activar interceptor con cookies inyectadas en requests a csrf
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const intercepted = resolveUrl(req.url());
      const extraHeaders = {};

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
  } catch (e) {
    console.warn(`[csrf] Error: ${e.message}`);
  } finally {
    await browser?.close();
  }
}


// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  userSessions,
  initSessions,
  verifyCsrfChallenge,
  visitCsrf,
};
