// ── banned_urls.js ────────────────────────────────────────────────────────────
// DB separada para URLs baneadas — compartida entre todos los procesos via nedb
const Datastore = require('nedb');
const { getBaseUrl } = require('./utils');

const banned_db = new Datastore({ filename: './banned_urls.db', autoload: true });
banned_db.ensureIndex({ fieldName: 'url', unique: true });

// Banear una URL (se guarda la base, sin query params)
function banUrl(url) {
  const base = getBaseUrl(url, 1);
  console.log(`[banned_urls] Baneando: ${base}`);
  banned_db.update(
    { url: base },
    { $set: { url: base, bannedAt: new Date() } },
    { upsert: true }
  );
}

// Verificar si una URL está baneada (startsWith sobre todas las baneadas)
function isBanned(url) {
  return new Promise((resolve, reject) => {
    banned_db.find({}, (err, docs) => {
      if (err) return reject(err);
      const banned = docs.some(doc => url.startsWith(doc.url));
      resolve(banned);
    });
  });
}

module.exports = { banUrl, isBanned };
