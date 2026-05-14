const express = require('express');
const router = express.Router();

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

/**
 * Helper to fetch a fresh token.
 */
async function getShopifyToken() {
  if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Missing Shopify configuration on server (SHOP, CLIENT_ID, or CLIENT_SECRET).');
  }

  const shopDomain = SHOP.includes('.myshopify.com') ? SHOP : `${SHOP}.myshopify.com`;
  
  const response = await fetch(
    `https://${shopDomain}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token request failed: ${response.status} - ${errorText}`);
  }

  return response.json();
}

/**
 * GET /auth/shopify/token
 * Returns a fresh Shopify access token using client_credentials flow.
 */
router.get('/shopify/token', async (req, res) => {
  try {
    const data = await getShopifyToken();
    return res.json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      scope: data.scope
    });
  } catch (error) {
    console.error('Error fetching Shopify token:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = { router, getShopifyToken };
