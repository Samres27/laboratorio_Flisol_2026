// ── bot.js ────────────────────────────────────────────────────────────────────
// Loop cada 5s: revisa inbox IMAP de cada usuario y visita links nuevos
// Al inicio de bot.js
const { userSessions, initSessions, verifyCsrfChallenge } = require('./csrf');
require('events').EventEmitter.defaultMaxListeners = 50;
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const Datastore = require('nedb');
const { visitXss } = require('./xss');
const { visitCsrf } = require('./csrf');
const { visitClickjacking, verifyReto1, verifyReto2 } = require('./clickjacking');

const IMAP_HOST = 'mailserver';
const IMAP_PORT = 143;
const MAIL_DOMAIN = 'vulnlab.bo';

const { db } = require('./init_db');

// Trackear último ID visto por usuario para no reprocesar
const lastSeenId = new Map(); // email → msgId


// ── Leer último email del inbox via IMAP ──────────────────────────────────────
function fetchLatestMail(email, password) {
  return new Promise((resolve) => {
    const imap = new Imap({
      user: email,
      password,
      host: IMAP_HOST,
      port: IMAP_PORT,
      tls: false,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 5000,
      connTimeout: 8000,
    });

    imap.once('error', (err) => {
      console.warn(`[bot] IMAP error ${email}: ${err.message}`);
      resolve(null);
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err || box.messages.total === 0) {
          imap.end();
          return resolve(null);
        }

        console.log("[email] revisando correo: " + email)
        const fetch = imap.seq.fetch(`${box.messages.total}:${box.messages.total}`, {
          bodies: '',
          struct: true,
        });

        let mail = null;

        let parsePromise = Promise.resolve();

        fetch.on('message', (msg) => {
          let buffer = '';
          let uid = null;

          msg.on('attributes', (attrs) => { uid = attrs.uid; });
          msg.on('body', (stream) => {
            stream.on('data', (chunk) => { buffer += chunk.toString(); });
          });
          msg.once('end', () => {
            parsePromise = simpleParser(buffer).then(parsed => {
              mail = { uid, subject: parsed.subject, text: parsed.text, html: parsed.html };
            }).catch(() => { });
          });
        });

        fetch.once('end', () => {
          imap.end();
          parsePromise.then(() => resolve(mail));
        });
      });
    });

    imap.connect();
  });
}

// ── Extraer primera URL del body del email ────────────────────────────────────
function extractUrl(mail) {
  const content = mail?.text ?? mail?.html ?? '';
  const cleanContent = content.replace(/[\r\n]+/g, ' ').replace(/=\s/g, '');
  const match = cleanContent.match(/https?:\/\/[^\s"<>]+/);
  return match ? match[0].trim() : null;
}

// ── Obtener todos los usuarios activos de la DB ───────────────────────────────
function getAllUsers() {
  return new Promise((resolve) => {
    db.find({ inhabited: false }, (err, docs) => resolve(err ? [] : docs));
  });
}

function getFlag(category, user) {
  return new Promise((resolve) => {
    db.findOne({ category, user }, (err, doc) => resolve(doc?.flag ?? null));
  });
}

// ── Procesar email nuevo según categoría ─────────────────────────────────────
async function processMail(reto, mail) {
  const url = extractUrl(mail);
  if (!url) {
    console.log(`[bot] Sin URL en mail de ${reto.user}`);
    return;
  }

  console.log(`[bot] [${reto.category}] ${reto.user} → ${url}`);
  console.log("lista de reto ->" + reto)
  console.log("flag reto ->" + reto.flag)

  switch (reto.category) {
    case 'xss': {
      const lastUrl = await visitXss(url, reto.flag);
      if (lastUrl) {
        db.update({ _id: reto._id }, { $set: { lastVisitedUrl: lastUrl } }, {});
        console.log(`[xss] lastVisitedUrl guardada: ${lastUrl}`);
      }
      break;
    }

    case 'csrf': {
      const lastUrl2 = await visitCsrf(url, reto.flag, {
        username: reto.user,
        password: reto.password,
      });
      verifyCsrfChallenge(reto.user, reto.flag);
      if (lastUrl2) {
        db.update({ _id: reto._id }, { $set: { lastVisitedUrl: lastUrl2 } }, {});
        console.log(`[csrf] lastVisitedUrl guardada: ${lastUrl2}`);
      }
      break;
    }

    case 'clickjacking': {
      const lastUrl3 = await visitClickjacking(url, reto.flag, {
        username: reto.user,
        password: reto.password,
      });
      if (lastUrl3) {
        db.update({ _id: reto._id }, { $set: { lastVisitedUrl: lastUrl3 } }, {});
        console.log(`[clickjacking] lastVisitedUrl guardada: ${lastUrl3}`);
      }
      await runClickjackingVerifications();
      break;
    }
  }
}

// ── Verificaciones periódicas de clickjacking ─────────────────────────────────
async function runClickjackingVerifications() {
  const retos = await new Promise(r => db.find({ category: 'clickjacking', inhabited: false }, (e, d) => r(d)));

  if (retos && retos.length > 0) {
    for (const reto of retos) {
      await verifyReto2(reto);
    }
  }
}

// ── Loop principal ────────────────────────────────────────────────────────────
async function botLoop() {
  const retos = await getAllUsers();
  for (const reto of retos) {
    const email = reto.email ?? `${reto.user.toLowerCase()}@vulnlab.bo`;
    const password = reto.password ?? reto.flag; // clickjacking: password=flag

    const mail = await fetchLatestMail(email, password);
    if (!mail) continue;

    // Solo procesar si es un mail nuevo
    const key = `${email}`;
    if (lastSeenId.get(key) === mail.uid) continue;

    lastSeenId.set(key, mail.uid);
    await processMail(reto, mail);
  }
}

// ── Arrancar ──────────────────────────────────────────────────────────────────
console.log('[bot] Iniciando loop cada 5s...');
setInterval(async () => {
  try {
    await botLoop();
  } catch (e) {
    console.error(`[bot] Error en loop: ${e.message}`);
  }
}, 5000);
