const puppeteer = require('puppeteer');
const FormData  = require('form-data');
const fetch     = require('node-fetch');
const https     = require('https');
const fs        = require('fs');
const path      = require('path');

const TARGET = 'https://clickjacking:443';

// Agente HTTPS que ignora cert autofirmado (para fetch directo)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// MP3 mínimo válido en base64 (44 bytes — header ID3 vacío)
const SILENT_MP3_B64 =
  'SUQzAwAAAAAAJlRYWFgAAAASAAADbWFqb3JfYnJhbmQAbXA0MgBJRDMD' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function silentMp3Buffer() {
  return Buffer.from(SILENT_MP3_B64, 'base64');
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-features=SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure',
    ],
  });
}

async function getSessionCookie(page) {
  const cookies = await page.cookies();
  return cookies.find(c => c.name === 'session') ?? null;
}

async function setSessionCookie(page, value) {
  // SameSite=None requiere Secure=true
  for (const domain of ['clickjacking', '127.0.0.1', 'localhost']) {
    await page.setCookie({
      name:     'session',
      value,
      domain,
      path:     '/',
      secure:   true,
      sameSite: 'None',
      httpOnly: true,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIÓN 1 — setupVictim
// Crea el usuario víctima y sube la canción privada con la flag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} victim   { username, email, password, recoveryEmail? }
 * @param {string} flag     El valor de la flag a usar como artista
 * @returns {string|null}   Session cookie del usuario creado, o null si falla
 */
async function setupVictim(victim, flag) {
  console.log(`[setup] Creando usuario víctima: ${victim.username}`);
  const browser = await launchBrowser();
  const page    = await browser.newPage();

  try {
    // 1. Registrar usuario
    await page.goto(`${TARGET}/register`, { waitUntil: 'networkidle2', timeout: 15000 });

    await page.type('input[name="username"]',       victim.username);
    await page.type('input[name="email"]',          victim.email);
    await page.type('input[name="password"]',       victim.password);

    if (victim.recoveryEmail) {
      await page.type('input[name="recovery_email"]', victim.recoveryEmail);
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
      page.click('button[type="submit"]'),
    ]);

    const url = page.url();
    if (!url.includes('/login')) {
      console.error(`[setup] Registro falló — URL actual: ${url}`);
      await browser.close();
      return null;
    }
    console.log(`[setup] Usuario ${victim.username} registrado ✅`);

    // 2. Login
    await page.type('input[name="username"]', victim.username);
    await page.type('input[name="password"]', victim.password);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
      page.click('button[type="submit"]'),
    ]);

    const sessionCookie = await getSessionCookie(page);
    if (!sessionCookie) {
      console.error('[setup] Login falló — no se obtuvo cookie de sesión');
      await browser.close();
      return null;
    }
    console.log(`[setup] Login exitoso ✅ session=${sessionCookie.value.substring(0, 12)}...`);

    // 3. Subir canción privada con la flag como artista via fetch
    //    (más confiable que Puppeteer para multipart/form-data con archivo)
    const mp3  = silentMp3Buffer();
    const form = new FormData();
    form.append('title',      'Secret Track');
    form.append('artist',     flag);           // ← flag como artista
    form.append('is_private', 'on');           // ← privada
    form.append('audio', mp3, {
      filename:    'track.mp3',
      contentType: 'audio/mpeg',
    });

    const uploadRes = await fetch(`${TARGET}/upload`, {
      method:  'POST',
      body:    form,
      headers: {
        ...form.getHeaders(),
        'Cookie': `session=${sessionCookie.value}`,
      },
      agent:    httpsAgent,
      redirect: 'manual',   // el 302 de éxito lo manejamos manualmente
    });

    if (uploadRes.status === 302 || uploadRes.status === 200) {
      console.log(`[setup] Canción privada con flag subida ✅`);
    } else {
      console.warn(`[setup] Upload respondió ${uploadRes.status} — verificar`);
    }

    await browser.close();
    return sessionCookie.value;

  } catch (e) {
    console.error(`[setup] Error: ${e.message}`);
    await browser.close();
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIÓN 2 — verifyReto1
// Reto 1: el atacante cambia el recovery email via clickjacking
// Verificación: intentar login con credenciales del atacante
// Si login ok → publicar canción pública con la flag (reward)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} attacker   { username, password } — credenciales del atacante
 * @param {object} adminCreds { username, password } — cuenta admin para publicar flag
 * @param {string} flag
 * @param {string} rewardTitle  Título de la canción reward
 * @returns {boolean}  true si el reto fue completado
 */
async function verifyReto1(attacker, adminCreds, flag, rewardTitle = 'Reto 1 — Flag') {
  console.log(`[reto1] Verificando si ${attacker.username} puede hacer login...`);
  const browser = await launchBrowser();
  const page    = await browser.newPage();

  try {
    await page.goto(`${TARGET}/login`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.type('input[name="username"]', attacker.username);
    await page.type('input[name="password"]', attacker.password);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
      page.click('button[type="submit"]'),
    ]);

    const sessionCookie = await getSessionCookie(page);
    const loginOk       = !!sessionCookie && !page.url().includes('/login');

    await browser.close();

    if (loginOk) {
      console.log(`[reto1] ✅ Login exitoso — reto 1 completado`);
      await publishFlag(adminCreds, flag, rewardTitle);
      return true;
    } else {
      console.log(`[reto1] ❌ Login fallido — reto 1 no completado aún`);
      return false;
    }

  } catch (e) {
    console.error(`[reto1] Error: ${e.message}`);
    await browser.close();
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNCIÓN 3 — verifyReto2
// Reto 2: el atacante elimina la cuenta de la víctima via clickjacking
// Verificación: intentar login con la víctima
// Si login falla (usuario no existe) → publicar flag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} victim     { username, password }
 * @param {object} adminCreds { username, password }
 * @param {string} flag
 * @param {string} rewardTitle
 * @returns {boolean}  true si el reto fue completado
 */
async function verifyReto2(victim, adminCreds, flag, rewardTitle = 'Reto 2 — Flag') {
  console.log(`[reto2] Verificando si la cuenta de ${victim.username} fue eliminada...`);
  const browser = await launchBrowser();
  const page    = await browser.newPage();

  try {
    await page.goto(`${TARGET}/login`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.type('input[name="username"]', victim.username);
    await page.type('input[name="password"]', victim.password);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
      page.click('button[type="submit"]'),
    ]);

    // Cuenta eliminada → sigue en /login con error
    const sessionCookie = await getSessionCookie(page);
    const accountGone   = !sessionCookie || page.url().includes('/login');

    await browser.close();

    if (accountGone) {
      console.log(`[reto2] ✅ Cuenta eliminada — reto 2 completado`);
      await publishFlag(adminCreds, flag, rewardTitle);
      return true;
    } else {
      console.log(`[reto2] ❌ Cuenta sigue existiendo — reto 2 no completado aún`);
      return false;
    }

  } catch (e) {
    console.error(`[reto2] Error: ${e.message}`);
    await browser.close();
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — publishFlag
// Publica una canción pública con la flag como artista usando cuenta admin
// ─────────────────────────────────────────────────────────────────────────────

async function publishFlag(adminCreds, flag, title) {
  console.log(`[flag] Publicando flag como canción pública: "${title}"`);
  const browser = await launchBrowser();
  const page    = await browser.newPage();

  try {
    // Login admin
    await page.goto(`${TARGET}/login`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.type('input[name="username"]', adminCreds.username);
    await page.type('input[name="password"]', adminCreds.password);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
      page.click('button[type="submit"]'),
    ]);

    const sessionCookie = await getSessionCookie(page);
    if (!sessionCookie) {
      console.error('[flag] Login admin falló');
      await browser.close();
      return false;
    }

    // Publicar via fetch (pública — sin is_private)
    const mp3  = silentMp3Buffer();
    const form = new FormData();
    form.append('title',  title);
    form.append('artist', flag);
    form.append('audio', mp3, { filename: 'flag.mp3', contentType: 'audio/mpeg' });

    const res = await fetch(`${TARGET}/upload`, {
      method:   'POST',
      body:     form,
      headers:  { ...form.getHeaders(), 'Cookie': `session=${sessionCookie.value}` },
      agent:    httpsAgent,
      redirect: 'manual',
    });

    console.log(`[flag] Canción publicada con flag ✅ (status ${res.status})`);
    await browser.close();
    return true;

  } catch (e) {
    console.error(`[flag] Error: ${e.message}`);
    await browser.close();
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { setupVictim, verifyReto1, verifyReto2, publishFlag };
