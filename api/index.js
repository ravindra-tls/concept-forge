'use strict';

// Vercel serverless entry: every /api/* request is rewritten here (vercel.json)
// and handed to the same zero-dependency handler the local server uses.
// req/res are Node-style objects on the Vercel Node runtime, so the handler
// works unchanged — including the NDJSON streaming deal endpoint.
const { requestHandler } = require('../server');

module.exports = requestHandler;
