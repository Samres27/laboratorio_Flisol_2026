const puppeteer = require('puppeteer');
const Datastore = require("nedb")

const { db } = require('./init_db');

let FLAG_VALUE = null
db.findOne({ category: 'xss', id: 5, inhabited: false }, (err, chal) => {
    if (err) {
        console.error(err);
        return;
    }

    if (!chal) {
        console.log("Challenge no encontrado");
        return;
    }
    FLAG_VALUE = chal.flag;
})
// funcions whit 
const TARGET_URL = process.env.TARGET_URL || 'http://xss';

const VISIT_INTERVAL = parseFloat(process.env.VISIT_INTERVAL || '0.6') * 1000;

const PAGES = [
    '/noexiste',
];

async function visit(page, url) {
    try {
        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });
        const status = response ? response.status() : null;
         console.log(`[victim] ${url} → ${status}`); //funcion muy pesada

        if (status === 200) {
            await page.waitForTimeout(5000);
        } else {
            await page.waitForTimeout(1000);
        }
    } catch (e) {
        console.log(`[victim] Error visiting ${url}: ${e.message}`);
    }
}

async function main() {
    const url = new URL(TARGET_URL);
    const cookieDomain = url.hostname;

    while (true) {
        try {
            const browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            const ctx = browser.defaultBrowserContext();
            const page = await browser.newPage();

            await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 10000 });

            const domains = ['flask', 'haproxy', 'localhost','xss'];

            for (const domain of domains) {
                await page.setCookie({
                    name: 'flagFlisol',
                    value: FLAG_VALUE,
                    domain: domain,
                    path: '/',
                });
            }

            // Verificar cookies
            const cookies = await page.cookies();
            for (const path of PAGES) {
                await visit(page, TARGET_URL + path);
                await new Promise(r => setTimeout(r, VISIT_INTERVAL));
            }

            await browser.close();
            //console.log(`[victim] Cycle done. Waiting ${VISIT_INTERVAL}ms ...`); //se llena muy rapido

        } catch (e) {
            console.log(`[victim] Cycle error: ${e.message}`);
        }

        await new Promise(r => setTimeout(r, VISIT_INTERVAL));
    }
}

main();
