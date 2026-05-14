const express = require('express');
const router = express.Router();
const { getShopifyToken } = require('./auth');
const { shopifyGraphQL } = require('./shopify');

// Slack interactive endpoint
router.post('/interactions', async (req, res) => {
  try {
    // Slack sends payload as a stringified JSON in application/x-www-form-urlencoded
    const payload = JSON.parse(req.body.payload || '{}');
    
    // Respond quickly to Slack to acknowledge receipt (required within 3 seconds)
    res.status(200).send();
    
    if (payload.type === 'block_actions') {
      for (const action of payload.actions) {
        if (action.action_id === 'send_invoice') {
          await handleSendInvoice(payload, action);
        }
      }
    }
  } catch (error) {
    console.error('Error handling Slack interaction:', error);
    if (!res.headersSent) res.status(500).send();
  }
});

async function handleSendInvoice(payload, action) {
  try {
    console.log("Slack action value:", action.value);
    // action.value contains the draft_order_id (and optionally email info)
    const { draft_order_id } = JSON.parse(action.value || '{}');
    
    if (!draft_order_id) {
      throw new Error("No draft order ID provided in Slack payload");
    }

    // 1. Get fresh token
    const tokenData = await getShopifyToken();
    const accessToken = tokenData.access_token;

    // 2. Execute draftOrderInvoiceSend mutation
    const query = `
      mutation draftOrderInvoiceSend($id: ID!) {
        draftOrderInvoiceSend(id: $id) {
          draftOrder { id invoiceUrl }
          userErrors { field message }
        }
      }
    `;
    
    const variables = { id: draft_order_id };
    
    const data = await shopifyGraphQL(accessToken, query, variables);
    if (data.errors) throw new Error(JSON.stringify(data.errors));
    
    const result = data?.data?.draftOrderInvoiceSend;
    if (result?.userErrors?.length) {
      throw new Error(JSON.stringify(result.userErrors));
    }

    // 3. Update the Slack message
    // payload.response_url is the webhook URL to update the specific message
    const blocks = payload.message.blocks;
    
    // Find the actions block and replace it with a success message
    const actionBlockIndex = blocks.findIndex(b => b.type === 'actions');
    if (actionBlockIndex !== -1) {
      blocks[actionBlockIndex] = {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "✅ *Invoice has been officially sent to the customer via Shopify!*"
        }
      };
    }
    
    await fetch(payload.response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replace_original: true,
        blocks: blocks
      })
    });
    
  } catch (err) {
    console.error("Slack handleSendInvoice error:", err);
    // Optionally update Slack with error message
    if (payload.response_url) {
      await fetch(payload.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replace_original: false,
          response_type: "ephemeral",
          text: `❌ Failed to send invoice: ${err.message}`
        })
      });
    }
  }
}

module.exports = router;
