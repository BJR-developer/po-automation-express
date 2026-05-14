/**
 * Shopify PO Automation API  –  Express.js
 * =========================================
 */

require('dotenv').config();

const express  = require('express');
const morgan   = require('morgan');
const path     = require('path');
const nunjucks = require('nunjucks');

// Routers
const authRouter = require('./routes/auth');
const shopifyRouter = require('./routes/shopify');

const app = express();

// Template engine – Nunjucks
nunjucks.configure(path.join(__dirname, '../templates'), {
  autoescape: true,
  express:    app,
  noCache:    process.env.NODE_ENV !== 'production',
});
app.set('view engine', 'html');

// Middleware
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
const publicPath = path.join(process.cwd(), 'public');
app.use('/static', express.static(publicPath));
app.use(express.static(publicPath));

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({
    status: "online",
    message: "Shopify PO Automation API is running.",
    endpoints: {
      auth: "/auth/shopify/token",
      shopify: ["/draft-orders", "/products/search", "/customers/search"]
    }
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: "ok", server: "express" });
});

// Mount Routers
app.use('/auth', authRouter);
app.use('/', shopifyRouter);

// ── Entry Point ───────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`🚀 Shopify PO Automation server running on http://localhost:${PORT}`);
});
