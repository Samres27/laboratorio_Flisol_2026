function resolveUrl(url) {
  if (url.includes('127.0.0.1:81')) return url.replace('127.0.0.1:81', 'csrf');
  if (url.includes('127.0.0.1:82')) return url.replace('127.0.0.1:82', 'clickjacking');
  if (url.includes('127.0.0.1')) return url.replace('127.0.0.1', 'xss');

  return url;
}

module.exports = { resolveUrl };