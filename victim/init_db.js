const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const Datastore = require('nedb');


const ACCOUNTS_FILE = '/mailserver-config/postfix-accounts.cf';
const MAIL_DOMAIN = 'vulnlab.bo';

const XSS_USERS = ['BJames', 'Mary', 'Michael', 'Patricia', 'John'];

const CSRF_USERS = [
  { username: 'mrodriguez', password: 'pollo1234' },
  { username: 'lperez', password: 'casa1234' },
  { username: 'agarcia', password: 'prado1234' },
];


const CLICKJACKING_USERS = ['samuel', 'douglas'];
const DOM_USERS = [
  { username: 'mariasantillana', password: '1234pavo' },
  { username: 'lusianaperez', password: '1234mesa' },
  { username: 'antoniacastillo', password: '1234famr' },
];
function hashPassword(password) {
  const salt = crypto.randomBytes(6).toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .substring(0, 8);
  const hashed = execSync(
    `mkpasswd -m sha-512 -S "${salt}" "${password}"`,
    { stdio: 'pipe' }
  ).toString().trim();
  return `{SHA512-CRYPT}${hashed}`;
}

// ── Paso 1: crear cuenta si no existe, o actualizar hash si ya existe ─────────
function createMailAccount(email, password) {
  try {
    const hash = hashPassword(password);
    let content = fs.existsSync(ACCOUNTS_FILE)
      ? fs.readFileSync(ACCOUNTS_FILE, 'utf8')
      : '';

    if (content.includes(`${email}|`)) {
      // Actualizar el hash de la línea existente
      content = content.replace(
        new RegExp(`^${email}\\|.*$`, 'm'),
        `${email}|${hash}`
      );
      fs.writeFileSync(ACCOUNTS_FILE, content);
      console.log(`[init] Hash actualizado: ${email}`);
    } else {
      fs.appendFileSync(ACCOUNTS_FILE, `${email}|${hash}\n`);
      console.log(`[init] Cuenta creada: ${email}`);
    }
  } catch (e) {
    console.warn(`[init] Error ${email}: ${e.message}`);
  }
}

function makeFlag(length = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── Paso 2: sincronizar hashes leyendo desde la DB existente ──────────────────
function syncMailAccounts(db) {
  return new Promise((resolve) => {
    db.find({}, (err, docs) => {
      if (err) return resolve();
      docs.forEach(doc => {
        const email = doc.email ?? `${doc.user.toLowerCase()}@${MAIL_DOMAIN}`;
        const password = doc.password ?? doc.flag;
        createMailAccount(email, password);
      });
      console.log('[init] Hashes sincronizados con la DB');
      resolve();
    });
  });
}

const DB_PATH = path.join(__dirname, 'data', 'retos.db');
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
const db = new Datastore({ filename: './data/retos.db', autoload: true });

function initDb() {
  db.find({}, (err, docs) => {
    if (err) return console.error(err);
    if (docs.length > 0) {
      console.log('DB ya contiene datos, omitiendo inserción inicial');
      return;
    }

    XSS_USERS.forEach((user, i) => {
      const flag = `Flisol{${makeFlag()}}`;
      const email = `${user.toLowerCase()}@${MAIL_DOMAIN}`;
      db.insert({ id: i + 1, flag, category: 'xss', inhabited: false, user, email, password: flag, lastVisitedUrl: null, banned: false });
      createMailAccount(email, flag);
    });

    CSRF_USERS.forEach((u, i) => {
      const flag = `Flisol{${makeFlag()}}`;
      const email = `${u.username}@${MAIL_DOMAIN}`;
      db.insert({ id: i, flag, category: 'csrf', inhabited: false, user: u.username, email, password: u.password, lastVisitedUrl: null, banned: false });
      createMailAccount(email, u.password);
    });

    CLICKJACKING_USERS.forEach((user, i) => {
      const flag = `Flisol{${makeFlag()}}`;
      const email = `${user}@${MAIL_DOMAIN}`;
      db.insert({ id: i, flag, category: 'clickjacking', inhabited: false, user, email, password: flag, lastVisitedUrl: null, banned: false });
      createMailAccount(email, flag);
    });
    DOM_USERS.forEach((u, i) => {
      const flag = `Flisol{${makeFlag()}}`;
      const email = `${u.username}@${MAIL_DOMAIN}`;
      db.insert({ id: i, flag, category: 'dom', inhabited: false, user: u.username, email, password: u.password, lastVisitedUrl: null, banned: false });
      createMailAccount(email, u.password);
    });
  });


  // creacion del admin
  createMailAccount("mail_solv", "admin123");
  console.log('[init] DB y cuentas listas');
  return db;
}

// ── Al arrancar: crear DB si no existe, siempre sincronizar hashes ────────────
if (require.main === module) {
  if (!fs.existsSync('./data/retos.db')) {
    db.loadDatabase((err) => {
      if (err) return console.warn('[init] Error:', err);
      initDb();
    });
  } else {
    console.log('[init] retos.db ya existe, sincronizando hashes...');
    db.loadDatabase((err) => {
      if (err) return console.warn('[init] Error:', err);
      syncMailAccounts(db).then(() => process.exit(0));
    });
  }
}
module.exports = { initDb, makeFlag, db };
