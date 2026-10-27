# 50 Cr Club Payment Webhook

Configure `PAYMENT_WEBHOOK_TOKEN` in the backend environment. Set the payment provider callback URL to `/api/payments/webhooks/50-cr-club` and send the configured value in the `X-Webhook-Token` header. Do not commit the token to source control; rotate it if it has been shared outside the deployment secret store.

The endpoint accepts a JSON event with user/customer details at the top level or under `data`, and payment details at the top level or under `payment` / `data.payment`. Common user fields include provider ID, name, phone, email, company, occupation, address, city, state, postal code, and country. Common payment fields include status, amount, currency, payment/order IDs, product/plan, method, and paid time. Example:

```json
{
  "event_id": "evt_123",
  "type": "payment.succeeded",
  "data": {
    "user": {
      "id": "user_456",
      "name": "Example User",
      "phone": "+919876543210",
      "email": "user@example.com"
    },
    "payment": {
      "payment_id": "pay_789",
      "status": "paid",
      "amount": 5000,
      "currency": "INR"
    }
  }
}
```

The CRM stores only normalized, explicitly allowed user/payment fields and receipt time; it does not retain the raw webhook body or card data. Provider event IDs are used for duplicate delivery detection. Admins can review events at `/50-cr-club`, open the user/payment details panel, and explicitly create leads from them. The lead form includes the CRM's existing fields, courses, profile options, sources, and statuses. Lead creation requires an active telecaller RM selected from a team; the server validates that team membership and assigns the lead through the normal CRM assignment flow so the RM can access it in their workspace.

Events received before the additional detail fields were added contain only the fields previously normalized. They must be resent to populate newly supported details. If the provider sends only a user ID, fetching the full profile requires that provider's user-details API URL, authentication method, and response shape; the webhook token alone cannot retrieve it.

The section currently lists all received payment events; no 50-crore amount threshold is applied.

## Automatic Conversion Review for Club RMs

When a telecaller designated as a 50 Cr Club RM converts a lead, the CRM checks verified purchase records for an exact email or normalized phone match. A verified match approves the conversion, uses the verified purchase amount as ticket size when available, tags the lead as `50-cr-club`, and links the purchase to the lead so it appears in the RM's My 50 Cr Club leads. The approval is recorded as an automatic verified-payment approval.

After a successful purchase sync with no match, the conversion is marked `direct` and remains in the normal team approval queue. A recent successful full sync is reused for five minutes. If the source is not configured or the refresh fails and no stored verified purchase matches, the conversion remains pending and unclassified; it is not labeled direct based on unavailable verification data. Non-Club telecallers and manager-entered conversions keep the existing approval behavior.

## VIP Market Memberships and Purchases

Set `ADMIN_PANEL_KEY` in the backend deployment environment. The admin-only CRM proxy uses it in the `X-Admin-Key` header to fetch memberships from `https://vip-market-edge.emergent.host/api/admin/memberships` and purchases from `https://vip-market-edge.emergent.host/api/admin/purchases`. The key is never sent to the browser. An optional `VIP_MARKET_ADMIN_URL` backend setting can override the `https://vip-market-edge.emergent.host/api/admin` base URL.

The 50 Cr Club page syncs and displays these as separate Memberships and Purchases sections. Synced records retain their CRM lead association across refreshes and can be converted to assigned leads using the existing lead form. The provider responses can be arrays or common `data`, `items`, `results`, or `records` envelopes. The CRM maps common member/customer and purchase fields; set the admin key before opening the page to enable the sync.