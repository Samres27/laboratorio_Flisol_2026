// ── clickjacking.js ───────────────────────────────────────────────────────────
const puppeteer = require('puppeteer');
const FormData  = require('form-data');
const fetch     = require('node-fetch');
const https     = require('https');

const TARGET      = 'https://clickjacking:443';
const httpsAgent  = new https.Agent({ rejectUnauthorized: false });

// MP3 mínimo válido en base64
const SILENT_MP3_B64 =
  'SUQzAwAAAAAAJlRYWFgAAAASAAADbWFqb3JfYnJhbmQAbXA0MgBJRDMD' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function silentMp3() {
  return Buffer.from(SILENT_MP3_B64, 'base64');
}

function launchBrowser() {
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

async function getSession(page) {
  const cookies = await page.cookies();
  return cookies.find(c => c.name === 'session') ?? null;
}

async function setSession(page, value) {
  for (const domain of ['clickjacking', '127.0.0.1', 'localhost']) {
    await page.setCookie({ name: 'session', value, domain, path: '/', secure: true, sameSite: 'None', httpOnly: true });
  }
}

// ── Login en SoundNest y obtener cookie ───────────────────────────────────────
async function loginSoundNest(page, username, password) {
  // Pre-aceptar cert autofirmado
  await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 8000 }).catch(() => {});
  await page.goto(`${TARGET}/login`, { waitUntil: 'networkidle2', timeout: 10000 });
  await page.type('input[name="username"]', username);
  await page.type('input[name="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
    page.click('button[type="submit"]'),
  ]);
  return getSession(page);
}

// ── Publicar canción con la flag (reward) ─────────────────────────────────────
async function publishFlag(sessionValue, flag, title) {
  const form = new FormData();
  form.append('title',  title);
  form.append('artist', flag);
  form.append('audio', silentMp3(), { filename: 'flag.mp3', contentType: 'audio/mpeg' });

  const res = await fetch(`${TARGET}/upload`, {
    method:   'POST',
    body:     form,
    headers:  { ...form.getHeaders(), 'Cookie': `session=${sessionValue}` },
    agent:    httpsAgent,
    redirect: 'manual',
  });
  console.log(`[clickjacking] Flag publicada "${title}" → ${res.status}`);
}

// ── visitClickjacking ─────────────────────────────────────────────────────────
// site: URL del PoC html (la página del atacante)
// sessionData: { username, password } de la víctima
const { resolveUrl } = require('./utils');

async function visitClickjacking(site, flag, sessionData) {
  const resolvedSite = resolveUrl(site);
  console.log(`[clickjacking] Visitando PoC: ${resolvedSite}`);
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    // Interceptar requests internas (iframes, recursos)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const intercepted = resolveUrl(req.url());
      if (intercepted !== req.url()) {
        console.log(`[intercept-clickjacking] ${req.url()} → ${intercepted}`);
      }
      req.continue({ url: intercepted });
    });

    // Login víctima en SoundNest
    const sessionCookie = await loginSoundNest(page, sessionData.username, sessionData.password);
    if (!sessionCookie) {
      console.warn(`[clickjacking] Login fallido para ${sessionData.username}`);
      return;
    }
    console.log(`[clickjacking] Sesión obtenida para ${sessionData.username}`);

    // Navegar al PoC
    const res = await page.goto(resolvedSite, { waitUntil: 'networkidle2', timeout: 10000 });
    console.log(`[clickjacking] PoC → ${res?.status()}`);

    // Esperar que iframe cargue
    await new Promise(r => setTimeout(r, 2000));

    // Clic por coordenadas físicas sobre el botón decoy
    await page.waitForSelector('#decoy_website a', { timeout: 5000 });
    const btn = await page.$('#decoy_website a');
    const box = await btn.boundingBox();

    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      console.log(`[clickjacking] Clic en (${Math.round(box.x + box.width/2)}, ${Math.round(box.y + box.height/2)})`);
    }

    await new Promise(r => setTimeout(r, 3000));
  } catch (e) {
    console.warn(`[clickjacking] Error visitando PoC: ${e.message}`);
  } finally {
    await browser?.close();
  }
}

// ── verifyReto1: atacante puede hacer login ───────────────────────────────────
// reto: { user, flag, password } — credenciales de la víctima
// Si el atacante cambió el recovery email → puede pedir reset → hacer login
// Verificamos indirectamente: intentamos login con credenciales conocidas del atacante
// (el atacante usa vuln@vulnlab.bo, su contraseña la define él)
// Aquí verificamos que el recovery_email de la víctima fue cambiado via API
async function verifyReto1(reto) {
  try {
    // Login como víctima para ver su perfil
    const res = await fetch(`${TARGET}/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ username: reto.user, password: reto.password }),
      agent:   httpsAgent,
      redirect: 'manual',
    });

    const setCookie = res.headers.get('set-cookie') ?? '';
    const session   = setCookie.match(/session=([^;]+)/)?.[1];
    if (!session) return;

    // Obtener perfil y verificar recovery_email
    const profileRes = await fetch(`${TARGET}/profile`, {
      headers: { 'Cookie': `session=${session}` },
      agent:   httpsAgent,
    });
    const html = await profileRes.text();

    // Si el recovery email fue cambiado a vuln@vulnlab.bo → reto completado
    if (html.includes('vuln@vulnlab.bo')) {
      console.log(`[clickjacking] ✅ Reto 1 completado — ${reto.user} recovery email cambiado`);
      await publishFlag(session, reto.flag, `Clickjacking Reto 1 — ${reto.user}`);

      // Marcar como completado en DB (se pasa la db desde bot.js via evento o callback)
      return true;
    }
  } catch (e) {
    console.warn(`[clickjacking] verifyReto1 error: ${e.message}`);
  }
  return false;
}

// ── verifyReto2: cuenta víctima eliminada ─────────────────────────────────────
async function verifyReto2(reto) {
  try {
    const res = await fetch(`${TARGET}/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ username: reto.user, password: reto.password }),
      agent:   httpsAgent,
      redirect: 'manual',
    });

    // Si login redirige a / → cuenta sigue existiendo
    // Si sigue en /login con error → cuenta eliminada ✅
    const location = res.headers.get('location') ?? '';
    const setCookie = res.headers.get('set-cookie') ?? '';

    if (!setCookie.includes('session') || location.includes('/login')) {
      console.log(`[clickjacking] ✅ Reto 2 completado — cuenta ${reto.user} eliminada`);

      // Necesitamos una sesión admin para publicar la flag
      // Usar la propia cuenta del reto si aún existe, sino loguear como admin
      // Por simplicidad publicamos via fetch con login previo al admin
      // (configura ADMIN_USER / ADMIN_PASS en env o hardcodea aquí)
      const adminUser = process.env.SOUNDNEST_ADMIN_USER ?? 'mail_solv';
      const adminPass = process.env.SOUNDNEST_ADMIN_PASS ?? 'admin123';

      const adminRes = await fetch(`${TARGET}/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({ username: adminUser, password: adminPass }),
        agent:   httpsAgent,
        redirect: 'manual',
      });
      const adminCookie = adminRes.headers.get('set-cookie') ?? '';
      const adminSession = adminCookie.match(/session=([^;]+)/)?.[1];

      if (adminSession) {
        await publishFlag(adminSession, reto.flag, `Clickjacking Reto 2 — ${reto.user}`);
      }
      return true;
    }
  } catch (e) {
    console.warn(`[clickjacking] verifyReto2 error: ${e.message}`);
  }
  return false;
}

module.exports = { visitClickjacking, verifyReto1, verifyReto2, publishFlag };
