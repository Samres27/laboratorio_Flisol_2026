// ── clickjacking.js ───────────────────────────────────────────────────────────
const puppeteer = require('puppeteer');
const FormData = require('form-data');
const fetch = require('node-fetch');
const https = require('https');

const TARGET = 'https://clickjacking:443';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// MP3 mínimo válido en base64
const SILENT_MP3_B64 =
    'SUQzAwAAAAAAJlRYWFgAAAASAAADbWFqb3JfYnJhbmQAbXA0MgBJRDMD' +
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function silentMp3() {
    return Buffer.from(SILENT_MP3_B64, 'base64');
}

function launchBrowser() {
    return puppeteer.launch({
        headless: 'new',
        ignoreHTTPSErrors: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-features=SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure',
        ],
    });
}

async function getSession(page) {
    const cookies = await page.cookies();
    return cookies.find(c => c.name === 'session') ?? null;
}

async function setSession(page, value) {
    for (const domain of ['clickjacking', '127.0.0.1', 'localhost']) {
        await page.setCookie({ name: 'session', value, domain, path: '/', secure: true, sameSite: 'None', httpOnly: true });
    }
}

// ── Login en SoundNest y obtener cookie ───────────────────────────────────────
async function loginSoundNest(page, username, password) {
    // Pre-aceptar cert autofirmado
    await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 8000 }).catch(() => { });
    await page.goto(`${TARGET}/login`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.type('input[name="username"]', username);
    await page.type('input[name="password"]', password);
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
        page.click('button[type="submit"]'),
    ]);
    return getSession(page);
}

// ── Publicar canción con la flag (reward) ─────────────────────────────────────
async function publishFlag(sessionValue, flag, title) {
    const form = new FormData();
    form.append('title', title);
    form.append('artist', flag);
    form.append('audio', silentMp3(), { filename: 'flag.mp3', contentType: 'audio/mpeg' });

    const res = await fetch(`${TARGET}/upload`, {
        method: 'POST',
        body: form,
        headers: { ...form.getHeaders(), 'Cookie': `session=${sessionValue}` },
        agent: httpsAgent,
        redirect: 'manual',
    });
    console.log(`[clickjacking] Flag publicada "${title}" → ${res.status}`);
}

// ── visitClickjacking ─────────────────────────────────────────────────────────
// site: URL del PoC html (la página del atacante)
// sessionData: { username, password } de la víctima
const { resolveUrl } = require('./utils');


async function visitClickjacking(site, flag, sessionData) {
    const resolvedSite = resolveUrl(site);
    console.log(`[clickjacking] Visitando PoC: ${resolvedSite}`);
    let browser;
    try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // 1. Login primero SIN interceptor
        const sessionCookie = await loginSoundNest(page, sessionData.username, sessionData.password);
        if (!sessionCookie) {
            console.warn(`[clickjacking] Login fallido para ${sessionData.username}`);
            return;
        }
        console.log(`[clickjacking] Sesión obtenida: ${sessionCookie.value.substring(0, 20)}...`);

        // 2. Guardar cookies
        const savedCookies = await page.cookies(TARGET);
        const sessionVal = savedCookies.find(c => c.name === 'session');
        const cookieHeader = sessionVal ? `session=${sessionVal.value}` : '';

        // 3. Interceptor DESPUÉS del login
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const intercepted = resolveUrl(req.url());

            const extraHeaders = {};
            if (intercepted.includes('clickjacking') && cookieHeader) {
                extraHeaders['Cookie'] = cookieHeader;
            }

            if (intercepted !== req.url()) {
                console.log(`[intercept] ${req.url()} → ${intercepted}`);
            }

            req.continue({ url: intercepted, headers: { ...req.headers(), ...extraHeaders } });
        });

        await page.evaluateOnNewDocument(() => {
            // Observar cuando se agregue el iframe al DOM y corregir su src
            const observer = new MutationObserver(() => {
                const iframe = document.querySelector('iframe');
                if (iframe && iframe.src.includes('127.0.0.1:82')) {
                    iframe.src = iframe.src.replace('127.0.0.1:82', 'clickjacking');
                    console.log('Iframe src corregido:', iframe.src);
                }
            });
            observer.observe(document, { childList: true, subtree: true });
        });

        // Luego navegar al PoC
        await page.goto(resolvedSite, { waitUntil: 'networkidle2', timeout: 10000 });
        console.log(`[clickjacking] PoC cargado`);

        // 5. Verificar que el iframe cargó correctamente
        const iframeStatus = await page.evaluate(() => {
            const iframe = document.querySelector('iframe');
            if (!iframe) return 'no iframe encontrado';
            return `src=${iframe.src}, loaded=${iframe.contentDocument !== null}`;
        });
        console.log(`[clickjacking] Iframe status: ${iframeStatus}`);

        // Guardar screenshot para ver qué cargó
        await page.screenshot({ path: '/tmp/poc.png' });

        // 6. Esperar que iframe cargue
        await new Promise(r => setTimeout(r, 3000));

        // 7. Clic en el botón decoy
        await page.waitForSelector('a', { timeout: 5000 });
        const allLinks = await page.$$('a');
        let btn = null;

        for (const link of allLinks) {
            const text = await link.evaluate(el => el.textContent.trim().toLowerCase());
            if (text.includes('click')) {
                btn = link;
                console.log(`[clickjacking] Primer botón encontrado: "${text}"`);
                break;  // ← primera coincidencia, salir
            }
        }

        if (!btn) {
            console.warn(`[clickjacking] No se encontró ningún <a> con texto "click"`);
            return;
        }

        const box = await btn.boundingBox();
        console.log(`[clickjacking] Botón en: x=${box?.x}, y=${box?.y}`);

        if (box) {
            const clickX = Math.round(box.x + box.width / 2);
            const clickY = Math.round(box.y + box.height / 2);
            console.log(`[clickjacking] Haciendo clic en (${clickX}, ${clickY})`);
            await page.mouse.click(clickX, clickY);
        }
        await new Promise(r => setTimeout(r, 3000));
        await page.screenshot({ path: '/tmp/after_click.png' });
        console.log(`[clickjacking] Screenshots en /tmp/poc.png y /tmp/after_click.png`);

    } catch (e) {
        console.warn(`[clickjacking] Error: ${e.message}`);
    } finally {
        await browser?.close();
    }
}
// ── verifyReto1: atacante puede hacer login ───────────────────────────────────
// reto: { user, flag, password } — credenciales de la víctima
// Si el atacante cambió el recovery email → puede pedir reset → hacer login
// Verificamos indirectamente: intentamos login con credenciales conocidas del atacante
// (el atacante usa vuln@vulnlab.bo, su contraseña la define él)
// Aquí verificamos que el recovery_email de la víctima fue cambiado via API
async function verifyReto1(reto) {
    try {
        // Login como víctima para ver su perfil
        const res = await fetch(`${TARGET}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ username: reto.user, password: reto.password }),
            agent: httpsAgent,
            redirect: 'manual',
        });

        const setCookie = res.headers.get('set-cookie') ?? '';
        const session = setCookie.match(/session=([^;]+)/)?.[1];
        if (!session) return;

        // Obtener perfil y verificar recovery_email
        const profileRes = await fetch(`${TARGET}/profile`, {
            headers: { 'Cookie': `session=${session}` },
            agent: httpsAgent,
        });
        const html = await profileRes.text();

        // Si el recovery email fue cambiado a vuln@vulnlab.bo → reto completado
        if (html.includes('vuln@vulnlab.bo')) {
            console.log(`[clickjacking] ✅ Reto 1 completado — ${reto.user} recovery email cambiado`);
            await publishFlag(session, reto.flag, `Clickjacking Reto 1 — ${reto.user}`);

            // Marcar como completado en DB (se pasa la db desde bot.js via evento o callback)
            return true;
        }
    } catch (e) {
        console.warn(`[clickjacking] verifyReto1 error: ${e.message}`);
    }
    return false;
}

// ── verifyReto2: cuenta víctima eliminada ─────────────────────────────────────
async function verifyReto2(reto) {
    try {
        const res = await fetch(`${TARGET}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ username: reto.user, password: reto.password }),
            agent: httpsAgent,
            redirect: 'manual',
        });

        // Si login redirige a / → cuenta sigue existiendo
        // Si sigue en /login con error → cuenta eliminada ✅
        const location = res.headers.get('location') ?? '';
        const setCookie = res.headers.get('set-cookie') ?? '';

        if (!setCookie.includes('session') || location.includes('/login')) {
            console.log(`[clickjacking] ✅ Reto 2 completado — cuenta ${reto.user} eliminada`);

            // Necesitamos una sesión admin para publicar la flag
            // Usar la propia cuenta del reto si aún existe, sino loguear como admin
            // Por simplicidad publicamos via fetch con login previo al admin
            // (configura ADMIN_USER / ADMIN_PASS en env o hardcodea aquí)
            const adminUser = process.env.SOUNDNEST_ADMIN_USER ?? 'mail_solv';
            const adminPass = process.env.SOUNDNEST_ADMIN_PASS ?? 'admin123';

            const adminRes = await fetch(`${TARGET}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ username: adminUser, password: adminPass }),
                agent: httpsAgent,
                redirect: 'manual',
            });
            const adminCookie = adminRes.headers.get('set-cookie') ?? '';
            const adminSession = adminCookie.match(/session=([^;]+)/)?.[1];

            if (adminSession) {
                await publishFlag(adminSession, reto.flag, `Clickjacking Reto 2 — ${reto.user}`);
            }
            return true;
        }
    } catch (e) {
        console.warn(`[clickjacking] verifyReto2 error: ${e.message}`);
    }
    return false;
}

async function findAllElementsWithC(page) {
    console.log('\n' + '='.repeat(60));
    console.log('🔍 BUSCANDO ELEMENTOS QUE CONTENGAN "C"');
    console.log('='.repeat(60));

    const results = await page.evaluate(() => {
        const allElements = document.querySelectorAll('*');
        const matches = [];

        for (const el of allElements) {
            const text = el.textContent?.trim() || '';
            const id = el.id || '';
            const className = el.className || '';
            const rect = el.getBoundingClientRect();

            // Buscar en texto, ID y clase
            const hasCInText = text.toLowerCase().includes('c');
            const hasCInId = id.toLowerCase().includes('c');
            const hasCInClass = className.toLowerCase().includes('c');

            // Buscar en atributos
            const attrsWithC = [];
            for (let i = 0; i < el.attributes.length; i++) {
                const attr = el.attributes[i];
                if (attr.name.toLowerCase().includes('c') ||
                    (attr.value && attr.value.toLowerCase().includes('c'))) {
                    attrsWithC.push(`${attr.name}="${attr.value.substring(0, 30)}"`);
                }
            }

            if (hasCInText || hasCInId || hasCInClass || attrsWithC.length > 0) {
                matches.push({
                    tag: el.tagName,
                    id: id || null,
                    class: className || null,
                    text: text.substring(0, 80),
                    hasCInText,
                    hasCInId,
                    hasCInClass,
                    attrsWithC: attrsWithC.slice(0, 3),
                    visible: rect.width > 0 && rect.height > 0,
                    position: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    }
                });
            }
        }

        return matches;
    });

    // Imprimir resultados
    console.log(`\n📊 TOTAL: ${results.length} elementos encontrados\n`);

    // Agrupar por tipo de coincidencia
    const byText = results.filter(r => r.hasCInText);
    const byId = results.filter(r => r.hasCInId);
    const byClass = results.filter(r => r.hasCInClass);
    const byAttr = results.filter(r => r.attrsWithC.length > 0);

    console.log(`📝 Por texto: ${byText.length}`);
    console.log(`🏷️ Por ID: ${byId.length}`);
    console.log(`🎨 Por clase: ${byClass.length}`);
    console.log(`🔧 Por atributos: ${byAttr.length}`);

    console.log('\n' + '-'.repeat(60));
    console.log('🔍 DETALLE DE ELEMENTOS:');
    console.log('-'.repeat(60));

    results.forEach((el, i) => {
        console.log(`\n${i + 1}. ${el.tag}${el.id ? '#' + el.id : ''}${el.class ? '.' + el.class.split(' ')[0] : ''}`);
        console.log(`   📍 Posición: (${el.position.x}, ${el.position.y}) ${el.position.width}x${el.position.height}`);
        console.log(`   👁️ Visible: ${el.visible}`);

        if (el.hasCInText) {
            console.log(`   📝 Texto: "${el.text}"`);
        }
        if (el.hasCInId) {
            console.log(`   🏷️ ID: ${el.id}`);
        }
        if (el.hasCInClass) {
            console.log(`   🎨 Clase: ${el.class}`);
        }
        if (el.attrsWithC.length > 0) {
            console.log(`   🔧 Atributos: ${el.attrsWithC.join(', ')}`);
        }
    });

    return results;
}


module.exports = { visitClickjacking, verifyReto1, verifyReto2, publishFlag };
