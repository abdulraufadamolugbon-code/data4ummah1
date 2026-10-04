# DATA 4 UMMAH by Olugbon: backend + web app

## Run locally
1. Install Node 18+ then run `npm install`
2. `cp .env.example .env` and fill it in (JWT_SECRET, PAYSTACK_SECRET_KEY, etc.)
3. `npm start` and open http://localhost:3000
4. Register with the email set as ADMIN_EMAIL. That account becomes the Developer.

## Paystack setup (automatic funding)
1. Paystack Dashboard > Settings > API Keys: copy the secret key into `.env`
2. Settings > API Keys & Webhooks: set the webhook URL to `https://YOUR-DOMAIN/api/paystack/webhook` (must be HTTPS, so deploy first)
3. Test mode uses `PAYSTACK_BANK=test-bank`. For live, ask Paystack to enable Dedicated Virtual Accounts on your business, then use `wema-bank` or `titan-paystack`.

## VTU provider (data and airtime delivery)
The adapter in `server.js` (function `vtu`) uses VTpass. Add your keys, set `MOCK_VTU=false`, then in the Developer panel set each plan's provider code to match your provider's catalogue. If you use another provider, change only that one function.

## Deploy
Any Node host with a persistent disk works (Railway, Render, a VPS). SQLite stores data in `data.db`, so keep that file on persistent storage and back it up.
