# Go live in about 10 minutes

## Step 1: Put the code on GitHub
Create a free GitHub account, make a new private repository, and upload everything in this folder (the `.gitignore` keeps secrets out).

## Option A: Railway (easiest, keeps your data)
1. railway.app > New Project > Deploy from GitHub repo > pick your repository. It builds from the Dockerfile.
2. Open the service > Variables. Add the values from `.env.example`. Start with `JWT_SECRET` (any long random text), `ADMIN_EMAIL` (your email), and `DB_PATH=/data/data.db`.
3. Service > Settings > Volumes > Add Volume, mount path `/data`. This keeps users and balances safe across restarts. Do not skip it.
4. Settings > Networking > Generate Domain. That address is your live site.
5. Add a variable `APP_URL` with that address (with https://), then redeploy.

## Option B: Render
1. render.com > New > Blueprint > pick your repository. It reads `render.yaml`.
2. Fill in the prompted values (ADMIN_EMAIL, APP_URL and any keys you have). The disk needs the paid Starter plan.
3. Open the address Render gives you.

## After it is live
1. Open your address, tap Create a new account, and register with your ADMIN_EMAIL. You become the Developer.
2. Paystack Dashboard > Settings > API Keys & Webhooks: set the webhook to `https://YOUR-ADDRESS/api/paystack/webhook`.
3. Edit `BASE` in `public/index.html` to your address before building the store apps, then push again.
4. Go live with money only after Paystack and your data provider approve your live keys: switch to `sk_live_...`, set `PAYSTACK_BANK=wema-bank`, add provider keys and set `MOCK_VTU=false`.

If something fails, open the host's Logs tab. A "failed to fetch" message in the app means the server is not running or the address is wrong.
