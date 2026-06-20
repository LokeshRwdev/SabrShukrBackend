const app = require('./src/app');

// Vercel's Node.js runtime can invoke an Express app directly.
// Do not wrap this with serverless-http, which expects AWS Lambda events.
module.exports = app;
