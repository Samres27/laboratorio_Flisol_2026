// ── csrf.js ─────────────────────────────────────────────────────────────────
// Módulo que maneja sesiones, setup de posts y verificación de retos CSRF

const FLASK_URL = 'http://csrf';

const userSessions = new Map();
// { username: { session, delete_token } }

const USERS = [
  { username: 'mrodriguez', password: 'pollo1234' },
  { username: 'lperez', password: 'casa1234' },
  { username: 'agarcia', password: 'prado1234' },
  
];
var flagMrodriguez
var flagLperez
var flagAgarcia



// ── Login ────────────────────────────────────────────────────────────────────

async function loginAndSaveSession(username, password) {
  const res = await fetch(`${FLASK_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
    redirect: 'manual',
  });

  const rawCookies = res.headers.getSetCookie?.() ?? res.headers.raw?.()['set-cookie'] ?? [];
  const cookies = {};
  for (const raw of rawCookies) {
    const [pair] = raw.split(';');
    const [name, value] = pair.trim().split('=');
    cookies[name.trim()] = value.trim();
  }

  if (!cookies['session']) {
    console.warn(`[csrf] Login fallido para ${username}`);
    return;
  }

  // ── Visitar my-posts para forzar generación de delete_token ───
  const res2 = await fetch(`${FLASK_URL}/my-posts`, {
    headers: { 'Cookie': `session=${cookies['session']}` },
  });

  const rawCookies2 = res2.headers.getSetCookie?.() ?? res2.headers.raw?.()['set-cookie'] ?? [];
  for (const raw of rawCookies2) {
    const [pair] = raw.split(';');
    const [name, value] = pair.trim().split('=');
    cookies[name.trim()] = value.trim();
  }

  console.log(`[csrf] Cookies de ${username}:`, cookies);

  userSessions.set(username, {
    session:      cookies['session'],
    delete_token: cookies['delete_token'] ?? null,
    username,
    password,
    resuelto: false,
  });

  console.log(`[csrf] Sesión guardada para ${username} — delete_token: ${cookies['delete_token'] ?? 'null'}`);
}

// ── CSRF token ───────────────────────────────────────────────────────────────

async function getCsrfToken(username) {
  const userData = userSessions.get(username);
  if (!userData?.session) return '';

  const res = await fetch(`${FLASK_URL}/post/create`, {
    headers: { 'Cookie': `session=${userData.session}` },
  });

  const html = await res.text();
  const match = html.match(/name="csrf_token"\s+value="([^"]+)"/);
  return match ? match[1] : '';
}

// ── Crear post con la flag en el body ────────────────────────────────────────

async function createPostForUser(username, flag,publishe=0) {
  const userData = userSessions.get(username);
  if (!userData?.session) {
    console.warn(`[csrf] Sin sesión para ${username}, no se puede crear post`);
    return;
  }

  const csrfToken = await getCsrfToken(username);
  if (!csrfToken) {
    console.warn(`[csrf] No se pudo obtener csrf_token para ${username}`);
    return;
  }

  const res = await fetch(`${FLASK_URL}/post/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `session=${userData.session}`,
    },
    body: new URLSearchParams({
      title: `Post secreto de ${username}`,
      body: flag,   // la flag va en el contenido del post
      csrf_token: csrfToken,
      published: publishe
    }),
    redirect: 'manual',
  });

  console.log(`[csrf] Post creado para ${username} → HTTP ${res.status}`);
}

// ── Verificadores ────────────────────────────────────────────────────────────

// lperez  → delete: el post con la flag NO debe aparecer en /my-posts
async function verifyDelete(flag,user) {
  let userData = userSessions.get(user);
  if (!userData?.session) return false;

  let res = await fetch(`${FLASK_URL}/my-posts`, {
    headers: { 'Cookie': `session=${userData.session}` },
  });
  let html = await res.text();
  if (!userData.resuelto && !html.includes(flag)){
    console.log("resuelto "+ user)
    userSessions.set(user, { ...userData, resuelto:true });
    createPostForUser(user, flagLperez,1)
    return true;
  }else{
    console.log("sin resolver"+user)
    
  }
}


// mrodriguez → create: un post con la flag como título en /feed público
async function verifyCreate(flag) {
  const userData = userSessions.get('mrodriguez');
  if (!userData?.session) return false;

  const res = await fetch(`${FLASK_URL}/my-posts`, {
    headers: { 'Cookie': `session=${userData.session}` },
  });
  const html = await res.text();
  
  if (!userData.resuelto && html.includes('Creado:')){
    console.log("Resuelto")
    const existing = userSessions.get("mrodriguez") || {};
    userSessions.set("mrodriguez", { ...existing, resuelto:true });
    createPostForUser('mrodriguez', flagMrodriguez,1)
  }else{
    console.log("sin resolver")
    return false
  }
}

// ── Verificador unificado ────────────────────────────────────────────────────

async function verifyCsrfChallenge(user, flag) {
  switch (user) {
    case 'lperez':
    case 'agarcia': return await verifyDelete(flag,user) ;
    case 'mrodriguez': return await verifyCreate(flag);
    default: return true; // reto sin verificación especial
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
// db se pasa desde server.js para consultar las flags de retos.db

async function initSessions(db) {
  console.log('[csrf] Iniciando login de usuarios...');
  await Promise.all(USERS.map(u => loginAndSaveSession(u.username, u.password)));
  console.log(`[csrf] Sesiones listas: ${[...userSessions.keys()].join(', ')}`);

  // Obtener flags desde retos.db y crear los posts
  const getFlag = (user) => new Promise((resolve) => {
    db.findOne({ category: 'csrf', user }, (err, doc) => resolve(doc?.flag ?? null));
  });

  // const [flagmrodriguez , flagLperez, flagAgarcia] = await Promise.all([
  //   getFlag('lperez'),
  //   getFlag('agarcia'),
  // ]);

  [flagMrodriguez , flagLperez, flagAgarcia] = await Promise.all([
    getFlag('mrodriguez'),
    getFlag('lperez'),
    getFlag('agarcia'),
  ]);
  if (flagLperez) await createPostForUser('lperez', flagLperez);
  if (flagAgarcia) await createPostForUser('agarcia', flagAgarcia);

  console.log('[csrf] Posts de retos creados');
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  userSessions,
  initSessions,
  verifyCsrfChallenge,
};
