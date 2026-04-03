// ── bot.js ────────────────────────────────────────────────────────────────────
require('events').EventEmitter.defaultMaxListeners = 50;
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { visitXss } = require('./xss');
const { visitCsrf } = require('./csrf');
const { visitClickjacking } = require('./clickjacking');

const IMAP_HOST = 'mailserver';
const IMAP_PORT = 143;
const INTERNAL = 'http://127.0.0.1:8081';

const lastSeenId = new Map();

// ── Helpers para comunicarse con internal.js ──────────────────────────────────
async function getUsers() {
  const res = await fetch(`${INTERNAL}/internal/users`);
  return res.json();
}

async function saveUrl(_id, lastVisitedUrl) {
  await fetch(`${INTERNAL}/internal/save-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ _id, lastVisitedUrl }),
  });
}

async function verifyCsrf(user, flag) {
  await fetch(`${INTERNAL}/internal/verify-csrf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, flag }),
  });
}

async function runClickjackingVerifications() {
  await fetch(`${INTERNAL}/internal/clickjacking-verifications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

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

        console.log("[email] revisando correo: " + email);
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
            }).catch(() => {});
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

// ── Procesar email nuevo según categoría ─────────────────────────────────────
async function processMail(reto, mail) {
  const url = extractUrl(mail);
  if (!url) {
    console.log(`[bot] Sin URL en mail de ${reto.user}`);
    return;
  }

  console.log(`[bot] [${reto.category}] ${reto.user} → ${url}`);

  switch (reto.category) {
    case 'xss': {
      const lastUrl = await visitXss(url, reto.flag);
      if (lastUrl) await saveUrl(reto._id, lastUrl);
      break;
    }
    case 'csrf': {
      const lastUrl2 = await visitCsrf(url, reto.flag, {
        username: reto.user,
        password: reto.password,
      });
      await verifyCsrf(reto.user, reto.flag);
      if (lastUrl2) await saveUrl(reto._id, lastUrl2);
      break;
    }
    case 'clickjacking': {
      const lastUrl3 = await visitClickjacking(url, reto.flag, {
        username: reto.user,
        password: reto.password,
      });
      if (lastUrl3) await saveUrl(reto._id, lastUrl3);
      await runClickjackingVerifications();
      break;
    }
  }
}

// ── Loop principal ────────────────────────────────────────────────────────────
async function botLoop() {
  let retos;
  try {
    retos = await getUsers();
  } catch (e) {
    console.warn('[bot] No se pudo conectar a internal:', e.message);
    return;
  }

  for (const reto of retos) {
    const email = reto.email ?? `${reto.user.toLowerCase()}@vulnlab.bo`;
    const password = reto.password ?? reto.flag;

    const mail = await fetchLatestMail(email, password);
    if (!mail) continue;

    if (lastSeenId.get(email) === mail.uid) continue;
    lastSeenId.set(email, mail.uid);

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
