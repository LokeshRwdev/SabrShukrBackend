const app = require('./src/app');

module.exports = (req, res) => {
  // The legacy Vercel route rewrites requests to /server.js. Pass the
  // captured path through __path so Express can route the original URL.
  const url = new URL(req.url, 'http://localhost');
  const originalPath = url.searchParams.get('__path');

  if (originalPath !== null) {
    url.searchParams.delete('__path');
    const query = url.searchParams.toString();
    req.url = `/${originalPath}${query ? `?${query}` : ''}`;
  }

  return app(req, res);
};
