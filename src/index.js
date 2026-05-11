/**
 * Shopify PO Automation API  –  Express.js
 * =========================================
 * GET  /                  → Homepage (shows token from localStorage for 1 hour)
 * GET  /install           → Start Shopify OAuth flow
 * GET  /callback          → OAuth callback — shows token to copy into n8n
 * POST /draft-orders      → Create a draft order  (X-Shopify-Access-Token header required)
 * GET  /draft-orders/:id  → Fetch a draft order   (X-Shopify-Access-Token header required)
 */

require('dotenv').config();

const express  = require('express');
const morgan   = require('morgan');
const axios    = require('axios');
const path     = require('path');
const nunjucks = require('nunjucks');

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const app = express();

// Template engine – Nunjucks (Jinja2-compatible syntax)
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
app.use('/static', express.static(path.join(__dirname, '../public')));

// ── Config ────────────────────────────────────────────────────────────────────

const CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const STORE         = process.env.SHOPIFY_STORE;
const REDIRECT_URI  = process.env.SHOPIFY_REDIRECT_URI;
const API_VERSION   = process.env.SHOPIFY_API_VERSION || '2026-07';
const SCOPES        = 'write_draft_orders,read_draft_orders,write_products,read_products';
const PORT          = parseInt(process.env.PORT || '3000', 10);

if (!CLIENT_ID || !CLIENT_SECRET || !STORE) {
  console.error('CRITICAL: Missing SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, or SHOPIFY_STORE in environment variables.');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Run a Shopify Admin GraphQL request.
 * @param {string} accessToken
 * @param {string} query
 * @param {object} [variables]
 * @returns {Promise<object>}
 */
async function shopifyGraphQL(accessToken, query, variables = {}) {
  const url = `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;
  const { data } = await axios.post(
    url,
    { query, variables },
    {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    }
  );
  return data;
}

function errorPage(res, title, message, status = 400) {
  return res.status(status).render('error.html', { title, message });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /
app.get('/', (_req, res) => {
  res.render('home.html');
});

// GET /install
app.get('/install', (req, res) => {
  if (!CLIENT_ID || !STORE || !REDIRECT_URI) {
    return errorPage(res, 'Config Error', 'Missing SHOPIFY_CLIENT_ID, SHOPIFY_STORE, or SHOPIFY_REDIRECT_URI in .env', 500);
  }

  const authUrl =
    `https://${STORE}/admin/oauth/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&scope=${SCOPES}` +
    `&redirect_uri=${REDIRECT_URI}`;

  console.log('Redirecting to Shopify OAuth');
  return res.redirect(authUrl);
});

// GET /callback
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return errorPage(res, 'Missing Code', 'No authorization code from Shopify. Try /install again.');
  }

  try {
    const { data } = await axios.post(
      `https://${STORE}/admin/oauth/access_token`,
      { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code },
      { timeout: 10_000 }
    );
    const token = data.access_token;

    if (!token) {
      return errorPage(res, 'No Token', 'Shopify did not return a token. The code may have expired — try /install again.');
    }

    console.log(`✅ Token obtained: ${token.slice(0, 12)}...`);
    return res.render('success.html', { token });
  } catch (err) {
    console.error(`Token exchange failed: ${err.message}`);
    return errorPage(res, 'Token Exchange Failed', err.message, 502);
  }
});

// POST /draft-orders
app.post('/draft-orders', async (req, res) => {
  const accessToken = req.headers['x-shopify-access-token'];
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing X-Shopify-Access-Token header' });
  }

  const body     = req.body || {};
  const rawItems = body.line_items || [];
  if (!rawItems.length) {
    return res.status(400).json({ error: 'line_items must not be empty' });
  }

  // Map snake_case input → Shopify GraphQL camelCase
  const gqlItems = rawItems.map((item) => {
    const gqlItem = { quantity: parseInt(item.quantity ?? 1, 10) };
    if (item.variant_id) {
      gqlItem.variantId = item.variant_id;
    } else {
      gqlItem.title             = item.title || 'Custom Item';
      gqlItem.originalUnitPrice = String(item.original_unit_price ?? '0.00');
    }
    return gqlItem;
  });

  const query = `
    mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder {
          id name status invoiceUrl
          lineItems(first: 20) {
            edges { node { title quantity originalUnitPrice } }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    input: {
      lineItems: gqlItems,
      note:      body.note  || '',
      email:     body.email || '',
    },
  };

  try {
    const data = await shopifyGraphQL(accessToken, query, variables);

    if (data.errors) {
      const messages = data.errors.map((e) => e.message);
      console.error(`GraphQL errors: ${messages}`);
      return res.status(403).json({ error: 'GraphQL error', details: messages });
    }

    const result     = data?.data?.draftOrderCreate ?? {};
    const userErrors = result.userErrors ?? [];
    if (userErrors.length) {
      return res.status(422).json({ error: 'Validation failed', details: userErrors });
    }

    const draft = result.draftOrder;
    if (!draft) {
      return res.status(500).json({ error: 'Draft order not created. Check app permissions.' });
    }

    console.log(`✅ Draft order: ${draft.name} (${draft.id})`);
    return res.status(201).json({
      id:          draft.id,
      name:        draft.name,
      status:      draft.status,
      invoice_url: draft.invoiceUrl,
      line_items:  (draft.lineItems?.edges ?? []).map(({ node }) => ({
        title:    node.title,
        quantity: node.quantity,
        price:    node.originalUnitPrice,
      })),
    });
  } catch (err) {
    if (err.response) {
      return res.status(502).json({ error: 'Shopify API error', detail: err.message });
    }
    return res.status(503).json({ error: 'Network error', detail: err.message });
  }
});

// GET /draft-orders/:id
app.get('/draft-orders/*', async (req, res) => {
  const accessToken = req.headers['x-shopify-access-token'];
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing X-Shopify-Access-Token header' });
  }

  // Support both numeric IDs and full GIDs
  let draftId = req.params[0];
  if (!draftId.startsWith('gid://')) {
    draftId = `gid://shopify/DraftOrder/${draftId}`;
  }

  const query = `
    query getDraftOrder($id: ID!) {
      draftOrder(id: $id) {
        id name status invoiceUrl
        lineItems(first: 20) {
          edges { node { title quantity originalUnitPrice } }
        }
      }
    }
  `;

  try {
    const data = await shopifyGraphQL(accessToken, query, { id: draftId });

    if (data.errors) {
      return res.status(403).json({ error: data.errors });
    }

    const draft = data?.data?.draftOrder;
    if (!draft) {
      return res.status(404).json({ error: 'Draft order not found' });
    }

    return res.status(200).json({
      id:          draft.id,
      name:        draft.name,
      status:      draft.status,
      invoice_url: draft.invoiceUrl,
      line_items:  (draft.lineItems?.edges ?? []).map(({ node }) => ({
        title:    node.title,
        quantity: node.quantity,
        price:    node.originalUnitPrice,
      })),
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

// ── Entry Point ───────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Shopify PO Automation server running on http://localhost:${PORT}`);
});
