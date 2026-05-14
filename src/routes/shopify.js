const express = require('express');
const router = express.Router();
const axios = require('axios');

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOP = process.env.SHOPIFY_SHOP;
const REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-04';
const SCOPES = 'write_draft_orders,read_draft_orders,write_products,read_products,read_customers,write_customers';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function shopifyGraphQL(accessToken, query, variables = {}) {
  const url = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
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
  // Assuming views are still set up in main app
  return res.status(status).render('error.html', { title, message });
}

// ── Legacy OAuth Routes (Kept as requested) ───────────────────────────────────

router.get('/install', (req, res) => {
  if (!CLIENT_ID || !SHOP || !REDIRECT_URI) {
    return errorPage(res, 'Config Error', 'Missing Shopify config in .env', 500);
  }
  const authUrl = `https://${SHOP}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${SCOPES}&redirect_uri=${REDIRECT_URI}`;
  return res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return errorPage(res, 'Missing Code', 'No authorization code from Shopify.');
  try {
    const { data } = await axios.post(
      `https://${SHOP}/admin/oauth/access_token`,
      { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code },
      { timeout: 10_000 }
    );
    const token = data.access_token;
    if (!token) return errorPage(res, 'No Token', 'Shopify did not return a token.');
    return res.render('success.html', { token });
  } catch (err) {
    return errorPage(res, 'Token Exchange Failed', err.message, 502);
  }
});

// ── Draft Orders ──────────────────────────────────────────────────────────────

router.post('/draft-orders', async (req, res) => {
  const accessToken = req.headers['x-shopify-access-token'];
  if (!accessToken) return res.status(401).json({ error: 'Missing X-Shopify-Access-Token header' });

  const body = req.body || {};
  const rawItems = body.line_items || [];
  if (!rawItems.length) return res.status(400).json({ error: 'line_items must not be empty' });

  const gqlItems = rawItems.map((item) => {
    const gqlItem = { quantity: parseInt(item.quantity ?? 1, 10) };
    if (item.variant_id) {
      gqlItem.variantId = item.variant_id;
    } else {
      gqlItem.title = item.title || 'Custom Item';
      gqlItem.originalUnitPrice = String(item.original_unit_price ?? '0.00');
    }
    return gqlItem;
  });

  const variables = {
    input: {
      lineItems: gqlItems,
      note: body.note || '',
      email: body.email || '',
    },
  };

  const customerId = body.customer_id || body.customerId;
  if (customerId) variables.input.customerId = customerId;

  if (body.shipping_address) {
    const sa = body.shipping_address;
    variables.input.shippingAddress = {
      address1: sa.address1 || sa.address || '',
      address2: sa.address2 || '',
      city: sa.city || '',
      zip: sa.zip || '',
      province: sa.province || '',
      country: sa.country || 'United States',
      firstName: sa.firstName || sa.first_name || '',
      lastName: sa.lastName || sa.last_name || '',
    };
  }

  const query = `
    mutation draftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id name status invoiceUrl totalPrice
          lineItems(first: 20) { edges { node { title quantity originalUnitPrice } } }
        }
        userErrors { field message }
      }
    }
  `;

  try {
    const data = await shopifyGraphQL(accessToken, query, variables);
    if (data.errors) return res.status(403).json({ error: 'GraphQL error', details: data.errors });
    const result = data?.data?.draftOrderCreate ?? {};
    if (result.userErrors?.length) return res.status(422).json({ error: 'Validation failed', details: result.userErrors });
    const draft = result.draftOrder;
    if (!draft) return res.status(500).json({ error: 'Draft order not created.' });
    return res.status(201).json({
      id: draft.id, name: draft.name, status: draft.status, invoice_url: draft.invoiceUrl,
      total_price: draft.totalPrice,
      line_items: (draft.lineItems?.edges ?? []).map(({ node }) => ({
        title: node.title, quantity: node.quantity, price: node.originalUnitPrice,
      })),
    });
  } catch (err) {
    return res.status(502).json({ error: 'Shopify API error', detail: err.message });
  }
});

router.get('/draft-orders/*', async (req, res) => {
  const accessToken = req.headers['x-shopify-access-token'];
  if (!accessToken) return res.status(401).json({ error: 'Missing token' });
  let draftId = req.params[0];
  if (!draftId.startsWith('gid://')) draftId = `gid://shopify/DraftOrder/${draftId}`;
  const query = `query getDraftOrder($id: ID!) { draftOrder(id: $id) { id name status invoiceUrl lineItems(first: 20) { edges { node { title quantity originalUnitPrice } } } } }`;
  try {
    const data = await shopifyGraphQL(accessToken, query, { id: draftId });
    if (data.errors) return res.status(403).json({ error: data.errors });
    const draft = data?.data?.draftOrder;
    if (!draft) return res.status(404).json({ error: 'Draft order not found' });
    return res.status(200).json({
      id: draft.id, name: draft.name, status: draft.status, invoice_url: draft.invoiceUrl,
      line_items: (draft.lineItems?.edges ?? []).map(({ node }) => ({ title: node.title, quantity: node.quantity, price: node.originalUnitPrice })),
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

// ── Search ────────────────────────────────────────────────────────────────────

router.get('/products/search', async (req, res) => {
  const accessToken = req.headers['x-shopify-access-token'];
  const searchTerm = req.query.q;
  if (!accessToken) return res.status(401).json({ error: 'Missing token' });
  if (!searchTerm) return res.status(400).json({ error: 'Missing query parameter q' });
  const query = `query searchProducts($query: String!) { products(first: 5, query: $query) { edges { node { id title variants(first: 10) { edges { node { id title price sku } } } } } } }`;
  try {
    const data = await shopifyGraphQL(accessToken, query, { query: `title:*${searchTerm}*` });
    const products = (data?.data?.products?.edges ?? []).map(({ node }) => ({
      id: node.id, title: node.title,
      variants: node.variants.edges.map(({ node: v }) => ({ id: v.id, title: v.title, price: v.price, sku: v.sku }))
    }));
    return res.json(products);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

router.get('/customers/search', async (req, res) => {
  const accessToken = req.headers['x-shopify-access-token'];
  const searchTerm = req.query.q;
  if (!accessToken) return res.status(401).json({ error: 'Missing token' });
  if (!searchTerm) return res.status(400).json({ error: 'Missing query parameter q' });
  const query = `query searchCustomers($query: String!) { customers(first: 5, query: $query) { edges { node { id firstName lastName email addresses(first: 10) { id address1 city province zip company } } } } }`;
  try {
    const data = await shopifyGraphQL(accessToken, query, { query: searchTerm });
    const customers = (data?.data?.customers?.edges ?? []).map(({ node }) => ({
      id: node.id, first_name: node.firstName, last_name: node.lastName, email: node.email,
      addresses: (node.addresses ?? []).map((a) => ({ id: a.id, address1: a.address1, city: a.city, province: a.province, zip: a.zip, company: a.company }))
    }));
    return res.json(customers);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

module.exports = router;
