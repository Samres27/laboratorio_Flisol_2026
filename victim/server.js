const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer');
const app = express();
const port = 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const TARGET_URL = 'http://flask:8000'
// ---init db ---------------------------------------
const Datastore = require("nedb");


const db = new Datastore({
  filename: "retos.db",
  autoload: true
})

const rutas = new Datastore({
  filename: "rutas.db",
  autoload: true
})

// ── Rutas ──────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.render('main'));
app.get('/xss', (req, res) => {
  db.find({ category: "xss" }, function (err, docs) {
    res.render('challenges', {
      challenges: docs.sort((a, b) => {
        return a.id - b.id;
      }), title: "Cross-Site Scripting (XSS)"
    })
  })

});
app.get('/csrf', (req, res) => {
  db.find({ category: "csrf" }, function (err, docs) {
    res.render('challenges', {
      challenges: docs.sort((a, b) => {
        return a.id - b.id;
      }), title: "Cross-site request forgery (CSRF)"
    })
  })
}
);

let tmpPath = null;

app.post('/api/check-flag', (req, res) => {
  const { category, challengeId, flag } = req.body;

  db.findOne({ flag: flag, category: category, id: challengeId, inhabited: false }, (err, chal) => {
    if (chal) {
      db.update(
        { _id: chal._id },
        { $set: { inhabited: true } },
        {},
        function (err, numReplaced) {
          console.log("update:", numReplaced,tmpPath)
          rutas.insert({
            flag: `${flag}`,
            challengeId: challengeId,
            path: tmpPath
          })
        }
      )
      res.json({ success: true, mensaje: ` ¡Correcto! Completaste el reto de ${chal.user}` });
    } else {
      res.json({ success: false, mensaje: ' Flag incorrecta. ¡Sigue intentando!' });
    }

  })
});


app.post('/api/mail', async (req, res) => {
  const { userId, title, body, category } = req.body;

  if (category == 'xss') {
    if (Number(userId) == 5) {
      return res.status(202).json({ mensaje: 'ocupado' });
    }

    const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    const detectedUrls = body.match(urlRegex);

    if (!detectedUrls) {
      return res.status(400).json({ mensaje: 'no se detectó una URL' });
    }
    if (["127.0.0.1","localhost"].some(host => detectedUrls[0].includes(host))){
      return res.status(400).json({ mensaje: 'host no valido' });
    }
    // Convertir el findOne a promesa
    const chal = await new Promise((resolve) => {
      db.findOne({ category, id: Number(userId), inhabited: false }, (err, doc) => {
        resolve(err ? null : doc);
      });
    });

    if (!chal) {
      return res.status(404).json({ mensaje: 'challenge no encontrado' });
    }

    const tmpFlag = chal.flag;
    tmpPath = await visit(detectedUrls[0], tmpFlag);

  
  }

  res.status(200).json({ mensaje: 'ok' });
});
// ── Inicio ─────────────────────────────────────────────────────────────────
app.listen(port, () => console.log(` CTF corriendo en http://localhost:${port}`));

//----- Funcion usuarioVuln
async function visit(site, flag) {
  const url = new URL(TARGET_URL);
  const cookieDomain = url.hostname;

  const blockedListRutes = await new Promise((resolve) => {
    rutas.find({}, (err, docs) => {
      resolve(docs.map(d => d.path).filter(Boolean));
    });
  });
  let captureRoute = null; 
  console.log(`[victim] Rutas bloqueadas: ${blockedListRutes}`);


  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });

    for (const domain of ['flask', 'haproxy', 'localhost', '127.0.0.1']) {
      await page.setCookie({ name: 'flagFlisol', value: flag, domain, path: '/' });
    }

    const cookies = await page.cookies();
    console.log(`[victim] Cookies: ${cookies.map(c => `${c.name}=${c.value}`).join('; ')}`);

    await page.setRequestInterception(true);

    page.on('request', (req) => {
      const rawUrl = req.url().replace('127.0.0.1', 'haproxy');

      if (!rawUrl.includes('haproxy')) {
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
        console.log(`[victim] Ruta bloqueada: ${rutaCompleta}`);
        req.abort();
        return;
      }

      if (rawUrl !== req.url()) {
        console.log(`[victim] Redirigiendo ${req.url()} → ${rawUrl}`);
        req.continue({ url: rawUrl });
      } else {
        req.continue();
      }
    });

    const response = await page.goto(site, { waitUntil: 'networkidle2', timeout: 10000 });
    const status = response ? response.status() : null;
    console.log(`[victim] ${site} → ${status}`);

    await new Promise(r => setTimeout(r, status === 200 ? 5000 : 1000));

    await browser.close();

    return captureRoute; 

  } catch (e) {
    console.log(`[victim] Error Visit: ${e.message}`);
    return null;
  }
}