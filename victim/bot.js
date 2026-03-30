// ── bot.js ────────────────────────────────────────────────────────────────────
// Loop cada 5s: revisa inbox IMAP de cada usuario y visita links nuevos
// Al inicio de bot.js
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

        // DESPUÉS
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
  // 1. Extraemos el contenido (asegurándonos de que 'mail' exista)
  const content = mail?.text ?? mail?.html ?? '';

  // 2. Limpiamos saltos de línea Y posibles caracteres de escape de email (como '=')
  // Muchos correos usan Quoted-Printable donde los saltos de línea se marcan con '='
  const cleanContent = content.replace(/[\r\n]+/g, ' ').replace(/=\s/g, '');

  // 3. Ejecutamos el match
  const match = cleanContent.match(/https?:\/\/[^\s"<>]+/);

  // 4. Retornamos el resultado limpio
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

  switch (reto.category) {
    case 'xss':
      await visitXss(url, reto.flag);
      break;

    case 'csrf':
      await visitCsrf(url, reto.flag, {
        username: reto.user,
        password: reto.password,
      });
      break;

    case 'clickjacking':
      await visitClickjacking(url, reto.flag, {
        username: reto.user,
        password: reto.password,
      });
      break;
  }
}

// ── Verificaciones periódicas de clickjacking ─────────────────────────────────
async function runClickjackingVerifications() {
  // Reto 0 (samuel) — atacante puede hacer login
  const reto0 = await new Promise(r => db.findOne({ category: 'clickjacking', id: 0, inhabited: false }, (e, d) => r(d)));
  if (reto0) {
    // El atacante usa vuln@vulnlab.bo como email de reset
    // Verificamos si puede hacer login — credenciales las define el atacante
    // Solo marcamos si el email de recovery fue cambiado (verificación externa)
    await verifyReto1(reto0);
  }

  // Reto 1 (douglas) — cuenta víctima eliminada
  const reto1 = await new Promise(r => db.findOne({ category: 'clickjacking', id: 1, inhabited: false }, (e, d) => r(d)));
  if (reto1) {
    await verifyReto2(reto1);
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

  // Verificaciones clickjacking en cada ciclo
  await runClickjackingVerifications();
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
