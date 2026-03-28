const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer');
const { setupVictim, verifyReto1, verifyReto2 } = require('./clickjacking_setup');
const app = express();
const port = 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));



// ── DB ────────────────────────────────────────────────────────────────────────
const Datastore = require("nedb");

const db = new Datastore({ filename: "retos.db", autoload: true });
const rutas = new Datastore({ filename: "rutas.db", autoload: true });

// ── Módulo CSRF ───────────────────────────────────────────────────────────────
const { userSessions, initSessions, verifyCsrfChallenge } = require('./csrf');

// ── Rutas ─────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.render('main'));

app.get('/xss', (req, res) => {
  db.find({ category: "xss" }, function (err, docs) {
    res.render('challenges', {
      challenges: docs.sort((a, b) => a.id - b.id),
      title: "Cross-Site Scripting (XSS)"
    });
  });
});

app.get('/csrf', (req, res) => {
  db.find({ category: "csrf" }, function (err, docs) {
    res.render('challenges', {
      challenges: docs.sort((a, b) => a.id - b.id),
      title: "Cross-site request forgery (CSRF)"
    });
  });
});

app.get('/clickjacking', (req, res) => {
  db.find({ category: "clickjacking" }, function (err, docs) {
    res.render('challenges', {
      challenges: docs.sort((a, b) => a.id - b.id),
      title: "clickjacking"
    });
  });
});
// ── Check flag ────────────────────────────────────────────────────────────────

let tmpPath = null;

app.post('/api/check-flag', async (req, res) => {
  const { category, challengeId, flag } = req.body;

  db.findOne({ flag, category, id: Number(challengeId), inhabited: false }, async (err, chal) => {
    if (!chal) {
      return res.json({ success: false, mensaje: 'Flag incorrecta. ¡Sigue intentando!' });
    }

    // Verificación extra para retos CSRF
    // if (category === 'csrf') {

    //   if (!completed) {
    //     return res.json({
    //       success: false,
    //       mensaje: 'Flag correcta pero el reto no fue completado aún. ¡Sigue intentando!'
    //     });
    //   }
    // }

    // Marcar como completado
    db.update(
      { _id: chal._id },
      { $set: { inhabited: true } },
      {},
      function (err, numReplaced) {
        console.log("update:", numReplaced, tmpPath);
        rutas.insert({ flag: `${flag}`, challengeId, path: tmpPath });
      }
    );

    res.json({ success: true, mensaje: `¡Correcto! Completaste el reto de ${chal.user}` });
  });
});

// ── Mail / visit ──────────────────────────────────────────────────────────────

app.post('/api/mail', async (req, res) => {
  const { userId, title, body, category } = req.body;
  var chal
  if (category === 'xss' || category === 'csrf') {
    if (Number(userId) == 5) {
      return res.status(202).json({ mensaje: 'ocupado' });
    }

    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    const detectedUrls = body.match(urlRegex);

    if (!detectedUrls) {
      return res.status(400).json({ mensaje: 'no se detectó una URL' });
    }
    if (["127.0.0.1", "localhost"].some(host => detectedUrls[0].includes(host))) {
      return res.status(400).json({ mensaje: 'host no valido' });
    }

    chal = await new Promise((resolve) => {
      db.findOne({ category, id: Number(userId), inhabited: false }, (err, doc) => {
        resolve(err ? null : doc);
      });
    });

    if (!chal) {
      return res.status(404).json({ mensaje: 'challenge no encontrado' });
    }

    // Para CSRF: pasar la sesión del usuario víctima a visit()
    const sessionData = category === 'csrf' ? userSessions.get(chal.user) : null;

    tmpPath = await visit(detectedUrls[0], chal.flag, sessionData, `http://${category}`);
  }
  if (category == 'csrf') {
    const completed = await verifyCsrfChallenge(chal.user, chal.flag);
  }


  res.status(200).json({ mensaje: 'ok' });
});

// ── Inicio ────────────────────────────────────────────────────────────────────

app.listen(port, async () => {
  console.log(`[server] Corriendo en http://localhost:${port}`);
  await initSessions(db);
});

// ── Función visit (Puppeteer) ─────────────────────────────────────────────────

async function visit(site, flag, sessionData = null, TARGET_URL) {
  const blockedListRutes = await new Promise((resolve) => {
    rutas.find({}, (err, docs) => {
      resolve(docs.map(d => d.path).filter(Boolean));
    });
  });

  let captureRoute = null;

  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox',
        '--disable-features=SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure']
    });
    const page = await browser.newPage();

    // ── Resolver sesión: preferir la guardada en userSessions ─────
    const username = sessionData?.username;
    const savedSession = username ? userSessions.get(username) : null;

    if (savedSession?.session) {
      // ✅ Reutilizar sesión existente — sin hacer login
      console.log(`[victim] Reutilizando sesión guardada para ${username}`);

      const domains = ['xss', 'csrf', 'flask', 'localhost', '127.0.0.1'];
      for (const domain of domains) {
        await page.setCookie({ name: 'session', value: savedSession.session, domain, path: '/', secure: false, sameSite: 'Lax' });
        await page.setCookie({ name: 'flagFlisol', value: flag, domain, path: '/', secure: false, sameSite: 'Lax' });
        await page.setCookie({ name: 'func_vuln', value: '1', domain, path: '/', secure: false, sameSite: 'Lax' });
      }

    } else if (sessionData?.username && sessionData?.password) {
      // ⚠️  No hay sesión guardada — hacer login y persistirla
      console.log(`[victim] Sin sesión guardada, haciendo login para ${username}`);

      await page.goto(`${TARGET_URL}/login`, { waitUntil: 'networkidle2', timeout: 10000 });
      await page.type('input[name="username"]', sessionData.username);
      await page.type('input[name="password"]', sessionData.password);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
        page.click('button[type="submit"]'),
      ]);

      const cookiesPostLogin = await page.cookies();
      const sessionCookie = cookiesPostLogin.find(c => c.name === 'session');

      if (sessionCookie) {
        // ✅ Persistir en userSessions para que verifyDelete la encuentre
        const existing = userSessions.get(username) || {};
        userSessions.set(username, { ...existing, session: sessionCookie.value });
        console.log(`[victim] Sesión persistida en userSessions para ${username}`);

        const domains = ['xss', 'csrf', 'flask', 'localhost', '127.0.0.1'];
        for (const domain of domains) {
          await page.setCookie({ name: sessionCookie.name, value: sessionCookie.value, domain, path: '/', httpOnly: sessionCookie.httpOnly, secure: false, sameSite: 'Lax' });
          await page.setCookie({ name: 'flagFlisol', value: flag, domain, path: '/', secure: false, sameSite: 'Lax' });
          await page.setCookie({ name: 'func_vuln', value: '1', domain, path: '/', secure: false, sameSite: 'Lax' });
        }
      }
    }

    // ── El resto de tu lógica sin cambios ─────────────────────────
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      let rawUrl = req.url()
        .replace('localhost:81', 'csrf')
        .replace('127.0.0.1:81', 'csrf')
        .replace('localhost', 'xss')
        .replace('127.0.0.1', 'xss');

      if (!rawUrl.includes('xss') && !rawUrl.includes('csrf')) {
        req.continue();
        return;
      }

      const parsed = new URL(rawUrl);
      const rutaCompleta = parsed.origin + parsed.pathname;

      if (!captureRoute) {
        captureRoute = rutaCompleta;
        console.log(`[victim] Ruta capturada: ${captureRoute}`);
      }

      const blocked = blockedListRutes.some(ruta => rutaCompleta.startsWith(ruta));
      if (blocked) {
        req.abort();
        return;
      }

      const extraHeaders = {};
      // ✅ Leer siempre desde userSessions (fuente única de verdad)
      const liveSession = username ? userSessions.get(username) : null;
      if (rawUrl.includes('csrf') && liveSession?.session) {
        const cookieParts = [`session=${liveSession.session}`];
        if (liveSession.delete_token) cookieParts.push(`delete_token=${liveSession.delete_token}`);
        extraHeaders['Cookie'] = cookieParts.join('; ');
      }

      req.continue({
        url: rawUrl !== req.url() ? rawUrl : undefined,
        headers: { ...req.headers(), ...extraHeaders }
      });
    });
    if (sessionData?.session) {
      console.log(`[victim] Refrescando delete_token para ${sessionData.username}`);

      const res = await fetch(`${TARGET_URL}/my-posts`, {
        headers: { 'Cookie': `session=${sessionData.session}` },
      });

      const rawCookies = res.headers.getSetCookie?.() ?? [];
      for (const raw of rawCookies) {
        const [pair] = raw.split(';');
        const [name, value] = pair.trim().split('=');
        if (name.trim() === 'delete_token') {
          sessionData.delete_token = value.trim();
          console.log(`[victim] delete_token refrescado: ${value.trim().substring(0, 10)}...`);
        }
      }
    }

    const response = await page.goto(site, { waitUntil: 'networkidle2', timeout: 10000 });
    const status = response?.status() ?? null;
    console.log(`[victim] ${site} → ${status}`);

    await new Promise(r => setTimeout(r, status === 200 ? 5000 : 1000));
    await browser.close();

    return captureRoute;

  } catch (e) {
    console.log(`[victim] Error Visit: ${e.message}`);
    return null;
  }
}
async function visitClickjacking(site, flag, sessionData = null, TARGET_URL) {
  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      ignoreHTTPSErrors: true,  // ← cert autofirmado
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-features=SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure'
      ]
    });

    const page = await browser.newPage();

    // ── Sesión: misma lógica que tu visit() ──────────────────────
    const username    = sessionData?.username;
    const savedSession = username ? userSessions.get(username) : null;
    const sessionValue = savedSession?.session ?? sessionData?.session ?? null;

    if (sessionValue) {
      console.log(`[clickjacking] Seteando sesión para ${username}`);

      // SameSite=None requiere secure=true obligatoriamente
      const domains = ['127.0.0.1', 'localhost'];
      for (const domain of domains) {
        await page.setCookie({
          name:     'session',
          value:    sessionValue,
          domain,
          path:     '/',
          secure:   true,   // ← requerido por SameSite=None
          sameSite: 'None', // ← debe coincidir con tu Flask
          httpOnly: true,
        });
        await page.setCookie({
          name:     'flagFlisol',
          value:    flag,
          domain,
          path:     '/',
          secure:   true,
          sameSite: 'None',
        });
      }
    } else if (sessionData?.username && sessionData?.password) {
      // Sin sesión guardada — hacer login primero en https
      console.log(`[clickjacking] Sin sesión, haciendo login en ${TARGET_URL}`);

      await page.goto(`${TARGET_URL}/login`, {
        waitUntil: 'networkidle2',
        timeout: 10000
      });

      await page.type('input[name="username"]', sessionData.username);
      await page.type('input[name="password"]', sessionData.password);

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
        page.click('button[type="submit"]'),
      ]);

      // Persistir sesión igual que tu visit()
      const cookiesPostLogin = await page.cookies();
      const sessionCookie    = cookiesPostLogin.find(c => c.name === 'session');

      if (sessionCookie) {
        const existing = userSessions.get(username) || {};
        userSessions.set(username, { ...existing, session: sessionCookie.value });
        console.log(`[clickjacking] Sesión persistida para ${username}`);
      }
    }

    // ── Navegar al sitio PoC de clickjacking ────────────────────
    console.log(`[clickjacking] Navegando a ${site}`);
    const response = await page.goto(site, {
      waitUntil: 'networkidle2',
      timeout: 10000
    });
    console.log(`[clickjacking] ${site} → ${response?.status()}`);

    // ── Esperar que el iframe cargue ─────────────────────────────
    await new Promise(r => setTimeout(r, 2000));

    // ── Clic por coordenadas físicas (emula clickjacking real) ───
    await page.waitForSelector('#decoy_website a', { timeout: 5000 });
    const decoyBtn = await page.$('#decoy_website a');
    const box      = await decoyBtn.boundingBox();

    if (box) {
      console.log(`[clickjacking] Clicando en (${box.x + box.width/2}, ${box.y + box.height/2})`);
      await page.mouse.click(
        box.x + box.width  / 2,
        box.y + box.height / 2
      );
    } else {
      console.log(`[clickjacking] No se encontró boundingBox del botón decoy`);
    }

    // ── Esperar que el iframe procese el clic ────────────────────
    await new Promise(r => setTimeout(r, 3000));
    await browser.close();

  } catch (e) {
    console.log(`[clickjacking] Error: ${e.message}`);
  }
}