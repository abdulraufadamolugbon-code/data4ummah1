# Put DATA 4 UMMAH on Google Play and the App Store

## 0. Before anything
1. Deploy the backend to a live HTTPS address (see README.md). Edit `BASE` in `public/index.html` to that address.
2. Your Paystack and data-provider accounts must be live (not test mode) before real users pay.

## 1. Installable web app (works now, free)
Open your live site on a phone and choose Add to Home Screen (Android Chrome also shows an Install button in Profile).

## 2. Build the Android and iPhone apps
```
npm install
npm run app:add      # creates android/ and ios/ folders
npm run app:icons    # makes all icon and splash sizes from assets/
npm run app:sync
npm run app:android  # opens Android Studio  -> Build > Generate Signed Bundle (.aab)
npm run app:ios      # opens Xcode (needs a Mac) -> Product > Archive
```
No Mac? Use a cloud build service such as Codemagic or Ionic Appflow for iOS.

## 3. Accounts and costs
- Google Play Console: one-time $25 fee. Upload the .aab, finish the listing, submit for review.
- Apple Developer Program: $99 per year. Upload with Xcode, then create the listing in App Store Connect.
- Both stores need a Privacy Policy web page and a support email. For finance apps, expect questions about how you hold customer money.
- Apple often rejects apps that are only a website in a frame. Add native value: push notifications for credit alerts, Face ID / fingerprint login, and a clear in-app account deletion option. I can build these next.

## 4. Store listing (copy and paste)
**Name:** DATA 4 UMMAH: Data & Airtime
**Short description (Play, 80 chars):** Cheap data and airtime. Fund by transfer. Instant delivery.
**Full description:**
DATA 4 UMMAH by Olugbon makes buying data and airtime simple. Get your own account number, send money from any bank app and your wallet credits automatically. Buy MTN, Airtel, Glo and 9mobile data in seconds, get cashback, and receive an email receipt for every transaction. Need to sell data? Send a request in the app.
**Keywords (Apple, 100 chars):** data,airtime,mtn,airtel,glo,9mobile,vtu,wallet,cheap data,recharge,bills,nigeria
**Category:** Finance (or Utilities)
**Screenshots:** Take them from Home, Buy Data, Fund Wallet and History.
