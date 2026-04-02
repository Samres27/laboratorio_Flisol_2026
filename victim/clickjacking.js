// ── clickjacking.js ───────────────────────────────────────────────────────────
const puppeteer = require('puppeteer');
const FormData = require('form-data');
const fetch = require('node-fetch');
const https = require('https');
const { resolveUrl, getBaseUrl } = require('./utils');
const { isBanned } = require('./banned_urls');

const TARGET = 'https://clickjacking';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function silentMp3() {
    return Buffer.from([
        0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
    ]);
}

function launchBrowser() {
    return puppeteer.launch({
        headless: 'new',
        ignoreHTTPSErrors: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox',
            '--disable-features=SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure'],
    });
}

async function getSession(page) {
    const cookies = await page.cookies();
    return cookies.find(c => c.name === 'session') ?? null;
}

async function loginSoundNest(page, username, password) {
    await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 8000 }).catch(() => {});
    await page.goto(`${TARGET}/login`, { waitUntil: 'networkidle2', timeout: 10000 });
    await page.type('input[name="username"]', username);
    await page.type('input[name="password"]', password);
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }),
        page.click('button[type="submit"]'),
    ]);
    return getSession(page);
}

async function publishFlag(sessionValue, flag, title, isPrivate = true) {
    const mp3 = silentMp3();
    const form = new FormData();
    form.append('title', title);
    form.append('artist', flag);
    form.append('audio', mp3, { filename: 'flag.mp3', contentType: 'audio/mpeg' });
    if (isPrivate) form.append('is_private', 'on');
    await fetch(`${TARGET}/upload`, {
        method: 'POST',
        body: form,
        headers: { ...form.getHeaders(), 'Cookie': `session=${sessionValue}` },
        agent: httpsAgent,
        redirect: 'manual',
    });
}

async function visitClickjacking(site, flag, sessionData) {
    const resolvedSite = resolveUrl(site);

    let browser;
    try {
        browser = await launchBrowser();
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // 1. Login
        const sessionCookie = await loginSoundNest(page, sessionData.username, sessionData.password);
        if (!sessionCookie) {
            console.warn(`[clickjacking] Login fallido para ${sessionData.username}`);
            return;
        }

        // 2. Guardar cookies
        const savedCookies = await page.cookies(TARGET);
        const sessionVal = savedCookies.find(c => c.name === 'session');
        const cookieHeader = sessionVal ? `session=${sessionVal.value}` : '';

        // 3. Interceptor — chequeo de baneo en el primer request hacia clickjacking
        await page.setRequestInterception(true);
        let basePath = null;
        let clickjackingChecked = false;

        page.on('request', async (req) => {
            const intercepted = resolveUrl(req.url());
            const extraHeaders = {};

            // Primer request que apunta a clickjacking → chequear baneo
            if (!clickjackingChecked && intercepted.includes('clickjacking')) {
                clickjackingChecked = true;
                basePath = getBaseUrl(intercepted, 1);
                const banned = await isBanned(basePath);
                if (banned) {
                    console.log(`[clickjacking] url baneada: ${basePath}`);
                    req.abort();
                    return;
                }
                console.log(`[clickjacking] url correcta: ${basePath}`);
            }

            if (intercepted.includes('clickjacking') && cookieHeader) {
                extraHeaders['Cookie'] = cookieHeader;
            }

            req.continue({ url: intercepted, headers: { ...req.headers(), ...extraHeaders } });
        });

        await page.evaluateOnNewDocument(() => {
            const observer = new MutationObserver(() => {
                const iframe = document.querySelector('iframe');
                if (iframe && iframe.src.includes('127.0.0.1:82')) {
                    iframe.src = iframe.src.replace('127.0.0.1:82', 'clickjacking');
                }
            });
            observer.observe(document, { childList: true, subtree: true });
        });

        // 4. Navegar al PoC
        await page.goto(resolvedSite, { waitUntil: 'networkidle2', timeout: 10000 });
        await page.screenshot({ path: '/tmp/poc.png' });
        await new Promise(r => setTimeout(r, 3000));

        // 5. Clic en botones decoy
        await page.waitForSelector('a', { timeout: 5000 });
        const allLinks = await page.$$('a');
        const clickTexts = ['click', 'click2'];
        const btns = [];

        for (const text of clickTexts) {
            for (const link of allLinks) {
                const linkText = await link.evaluate(el => el.textContent.trim().toLowerCase());
                if (linkText.includes(text) && !btns.includes(link)) {
                    btns.push(link);
                    break;
                }
            }
        }

        if (btns.length === 0) {
            console.warn(`[clickjacking] No se encontraron botones`);
            return;
        }

        for (const btn of btns) {
            const box = await btn.boundingBox();
            if (box) {
                await page.mouse.click(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        await new Promise(r => setTimeout(r, 3000));
        await page.screenshot({ path: '/tmp/after_click.png' });
        return basePath;

    } catch (e) {
        console.warn(`[clickjacking] Error: ${e.message}`);
    } finally {
        await browser?.close();
    }
}

async function verifyReto1(reto) {
    try {
        const res = await fetch(`${TARGET}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ username: reto.user, password: reto.password }),
            agent: httpsAgent, redirect: 'manual',
        });
        const setCookie = res.headers.get('set-cookie') ?? '';
        const sessionValue = setCookie.match(/session=([^;]+)/)?.[1] ?? '';
        if (sessionValue) {
            const profileRes = await fetch(`${TARGET}/profile`, {
                headers: { 'Cookie': `session=${sessionValue}` }, agent: httpsAgent,
            });
            const html = await profileRes.text();
            const match = html.match(/recovery[_\s]?email[^:]*:\s*([^\s<]+)/i);
            if (match && match[1] !== `${reto.user}@vulnlab.bo`) {
                await publishFlag(sessionValue, reto.flag, `Clickjacking Reto 1 — ${reto.user}`, false);
                return true;
            }
        }
    } catch (e) {
        console.warn(`[clickjacking] verifyReto1 error: ${e.message}`);
    }
    return false;
}

async function verifyReto2(reto) {
    try {
        const res = await fetch(`${TARGET}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ username: reto.user, password: reto.password }),
            agent: httpsAgent, redirect: 'manual',
        });
        const setCookie = res.headers.get('set-cookie') ?? '';
        const sessionValue = setCookie.match(/session=([^;]+)/)?.[1] ?? '';
        const accountDeleted = !sessionValue || sessionValue.trim() === '' || setCookie.includes('Max-Age=0');

        if (accountDeleted) {
            let sessionToUse = null;
            const adminRes = await fetch(`${TARGET}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    username: process.env.SOUNDNEST_ADMIN_USER ?? 'mail_solv',
                    password: process.env.SOUNDNEST_ADMIN_PASS ?? 'admin123',
                }),
                agent: httpsAgent, redirect: 'manual',
            });
            sessionToUse = adminRes.headers.get('set-cookie')?.match(/session=([^;]+)/)?.[1] ?? null;
            if (!sessionToUse) sessionToUse = await registerTempUser();
            if (sessionToUse) {
                await publishFlag(sessionToUse, reto.flag, `Clickjacking Reto 2 — ${reto.user}`, false);
            }
            return true;
        }
    } catch (e) {
        console.warn(`[verifyReto2] Error verificando ${reto.user}: ${e.message}`);
    }
    return false;
}

async function registerTempUser() {
    const tempUser = `bot_${Date.now()}`;
    const tempPass = 'BotPass123!';
    await fetch(`${TARGET}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: tempUser, password: tempPass, email: `${tempUser}@vulnlab.bo`, confirm_password: tempPass }),
        agent: httpsAgent, redirect: 'manual',
    });
    const loginRes = await fetch(`${TARGET}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: tempUser, password: tempPass }),
        agent: httpsAgent, redirect: 'manual',
    });
    return loginRes.headers.get('set-cookie')?.match(/session=([^;]+)/)?.[1] ?? null;
}

module.exports = { visitClickjacking, verifyReto1, verifyReto2, publishFlag };
