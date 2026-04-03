// ── internal.js ───────────────────────────────────────────────────────────────
// Servidor interno en :8081 — solo accesible desde dentro del contenedor
// Los bots leen y escriben la DB exclusivamente a través de este servidor

const express = require('express');
const { db } = require('./init_db');
const { banUrl } = require('./banned_urls');
const { verifyCsrfChallenge } = require('./csrf');

const app = express();
app.use(express.json());

// ── Cola para serializar escrituras a la DB ───────────────────────────────────
let dbQueue = Promise.resolve();
function enqueue(fn) {
  dbQueue = dbQueue.then(fn).catch(e => console.error('[internal] queue error:', e.message));
  return dbQueue;
}

// ── GET /internal/users — todos los retos no resueltos ───────────────────────
app.get('/internal/users', (req, res) => {
  db.find({ inhabited: false }, (err, docs) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(docs);
  });
});

// ── GET /internal/flag/:category/:id — flag de un reto específico ────────────
app.get('/internal/flag/:category/:id', (req, res) => {
  const { category, id } = req.params;
  db.findOne({ category, id: Number(id) }, (err, doc) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!doc) return res.status(404).json({ error: 'no encontrado' });
    res.json({ flag: doc.flag });
  });
});

// ── POST /internal/save-url — guardar lastVisitedUrl ─────────────────────────
app.post('/internal/save-url', (req, res) => {
  const { _id, lastVisitedUrl } = req.body;
  if (!_id || !lastVisitedUrl) return res.status(400).json({ error: 'faltan campos' });

  enqueue(() => new Promise((resolve) => {
    db.update({ _id }, { $set: { lastVisitedUrl } }, {}, (err) => {
      if (err) console.error('[internal] save-url error:', err.message);
      else console.log(`[internal] lastVisitedUrl guardada: ${lastVisitedUrl}`);
      resolve();
    });
  }));

  res.json({ ok: true });
});

// ── POST /internal/verify-csrf — verificar reto csrf ─────────────────────────
app.post('/internal/verify-csrf', async (req, res) => {
  const { user, flag } = req.body;
  if (!user || !flag) return res.status(400).json({ error: 'faltan campos' });
  try {
    const result = await verifyCsrfChallenge(user, flag);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /internal/clickjacking-verifications — verificar retos clickjacking ──
app.post('/internal/clickjacking-verifications', async (req, res) => {
  const { verifyReto2 } = require('./clickjacking');
  const retos = await new Promise(r =>
    db.find({ category: 'clickjacking', inhabited: false }, (e, d) => r(d ?? []))
  );
  for (const reto of retos) {
    await verifyReto2(reto);
  }
  res.json({ ok: true });
});

// ── Arrancar ──────────────────────────────────────────────────────────────────
const INTERNAL_PORT = 8081;
app.listen(INTERNAL_PORT, '127.0.0.1', () => {
  console.log(`[internal] Corriendo en http://127.0.0.1:${INTERNAL_PORT}`);
});

module.exports = app;
