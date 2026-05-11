# Shopify PO Automation – Express.js

A complete migration of the Python/Flask API to **Node.js + Express**. All routes, templates and static assets are preserved 1-to-1.

## Project Structure

```
express-server/
├── src/
│   └── index.js          # Express server (all routes)
├── templates/
│   ├── home.html         # Homepage (Nunjucks)
│   ├── success.html      # OAuth success page
│   └── error.html        # Error page
├── public/               # Static assets (= python-scripts/static/)
│   ├── style.css
│   ├── home.js
│   └── success.js
├── .env                  # Secrets (git-ignored)
├── .env.example          # Template for new setups
├── vercel.json           # Vercel deployment (Node runtime)
└── package.json
```

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/` | Homepage – shows saved token for 1 hour |
| `GET`  | `/install` | Start Shopify OAuth flow |
| `GET`  | `/callback` | OAuth callback – shows token |
| `POST` | `/draft-orders` | Create a draft order |
| `GET`  | `/draft-orders/:id` | Fetch a draft order |

## Quick Start

```bash
cd express-server
npm install
npm run dev        # http://localhost:3000
```

## Environment Variables

Copy `.env.example` → `.env` and fill in your values:

| Variable | Description |
|----------|-------------|
| `SHOPIFY_CLIENT_ID` | From Partner Dashboard |
| `SHOPIFY_CLIENT_SECRET` | From Partner Dashboard |
| `SHOPIFY_STORE` | `your-store.myshopify.com` |
| `SHOPIFY_REDIRECT_URI` | OAuth callback URL |
| `SHOPIFY_API_VERSION` | Default: `2026-07` |
| `PORT` | Default: `3000` |

## API Usage

### Create Draft Order

```bash
curl -X POST http://localhost:3000/draft-orders \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Access-Token: YOUR_TOKEN" \
  -d '{
    "line_items": [
      {
        "title": "BJR Premium Service",
        "original_unit_price": "299.99",
        "quantity": 1
      }
    ],
    "note": "Test order",
    "email": "customer@example.com"
  }'
```

### Get Draft Order

```bash
curl http://localhost:3000/draft-orders/12345 \
  -H "X-Shopify-Access-Token: YOUR_TOKEN"
```

## Deployment (Vercel)

```bash
vercel --prod
```

Set all environment variables in the Vercel dashboard before deploying.
