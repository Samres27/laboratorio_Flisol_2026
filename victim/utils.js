
function resolveUrl(url) {
  if (url.includes('127.0.0.1:81')) return url.replace('127.0.0.1:81', 'csrf');
  if (url.includes('127.0.0.1:82')) return url.replace('127.0.0.1:82', 'clickjacking');
  if (url.includes('127.0.0.1')) return url.replace('127.0.0.1', 'xss');

  return url;
}
function banUrl(db, url, category, user) {
  console.log("[banurk]: " + url)
  db.update(
    { user, category, lastVisitedUrl: url },
    { $set: { banned: true } },
    {}
  );
}

async function searchBanUrl(db, url) {
  console.log("[searchBanUrl]: " + url)
  return new Promise((resolve, reject) => {
    db.findOne({ lastVisitedUrl: url, banned: true }, (err, doc) => {
      if (err) reject(err);
      resolve(!!doc);
    });
  });
}
function getBaseUrl(input, nivelesMax = 1) {
  
  const raw = input.startsWith('http') ? input : `http://${input}`;
  const url = new URL(raw);

  const niveles = url.pathname
    .split("/")
    .filter(Boolean)
    .slice(0, nivelesMax);

  const basePath = niveles.length > 0 ? "/" + niveles.join("/") : "";

  return url.origin + basePath;
}

module.exports = { resolveUrl, getBaseUrl, searchBanUrl, banUrl };