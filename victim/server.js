// ── server.js ─────────────────────────────────────────────────────────────────
require('./init_db');

const express = require('express');
const path = require('path');
const Datastore = require('nedb');

const { userSessions, initSessions, verifyCsrfChallenge } = require('./csrf');
const { setupVictim } = require('./clickjacking_setup');
const { URLBan } = require('./xss');

const app = express();
const port = 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const { db } = require('./init_db');


// ── Vistas ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.render('main'));

app.get('/xss', (req, res) => {
  db.find({ category: 'xss' }, (err, docs) => {
    res.render('challenges', { challenges: docs.sort((a, b) => a.id - b.id), title: 'Cross-Site Scripting (XSS)' });
  });
});

app.get('/csrf', (req, res) => {
  db.find({ category: 'csrf' }, (err, docs) => {
    res.render('challenges', { challenges: docs.sort((a, b) => a.id - b.id), title: 'Cross-site Request Forgery (CSRF)' });
  });
});

app.get('/clickjacking', (req, res) => {
  db.find({ category: 'clickjacking' }, (err, docs) => {
    res.render('challenges', { challenges: docs.sort((a, b) => a.id - b.id), title: 'Clickjacking' });
  });
});

// ── Check flag ────────────────────────────────────────────────────────────────
app.post('/api/check-flag', (req, res) => {
  const { category, challengeId, flag } = req.body;
  db.findOne({ flag, category, id: Number(challengeId), inhabited: false }, (err, chal) => {
    if (!chal) {
      return res.json({ success: false, mensaje: 'Flag incorrecta. ¡Sigue intentando!' });
    }

    const urlToBan = chal.lastVisitedUrl; // leer antes de limpiar
    db.update(
      { _id: chal._id },
      { $set: { inhabited: true, lastVisitedUrl: null } }, // limpiar al mismo tiempo
      {},
      () => {
        if (urlToBan) URLBan(urlToBan, chal.user, category);
      }
    );

    res.json({ success: true, mensaje: `¡Correcto! Completaste el reto de ${chal.user}` });
  });
});

// ── Arrancar ──────────────────────────────────────────────────────────────────
app.listen(port, async () => {
  console.log(`[server] Corriendo en http://localhost:${port}`);

  try {
    await initSessions(db);
  } catch (e) {
    console.warn(`[server] CSRF init omitido (servicio no disponible): ${e.message}`);
  }

  try {
    const getFlag = (user) => new Promise(resolve =>
      db.findOne({ category: 'clickjacking', user }, (err, doc) => resolve(doc?.flag ?? null))
    );
    const flagSamuel = await getFlag('samuel');
    const flagDouglas = await getFlag('douglas');
    if (flagSamuel) await setupVictim({ username: 'samuel', email: 'samuel@vulnlab.bo', password: flagSamuel }, flagSamuel);
    if (flagDouglas) await setupVictim({ username: 'douglas', email: 'douglas@vulnlab.bo', password: flagDouglas }, flagDouglas);
  } catch (e) {
    console.warn(`[server] Clickjacking setup omitido: ${e.message}`);
  }
});
