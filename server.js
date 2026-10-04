require("dotenv").config();
const express = require("express"), helmet = require("helmet"), rateLimit = require("express-rate-limit");
const cors = require("cors"), crypto = require("crypto"), jwt = require("jsonwebtoken"), bcrypt = require("bcryptjs");
const Database = require("better-sqlite3"), path = require("path"), nodemailer = require("nodemailer");
const E = process.env, PS = "https://api.paystack.co";
const db = new Database(E.DB_PATH || path.join(__dirname, "data.db")); db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, phone TEXT, pass TEXT,
 balance INTEGER DEFAULT 0, cashback INTEGER DEFAULT 0, admin INTEGER DEFAULT 0,
 ps_customer TEXT, dva_number TEXT, dva_bank TEXT, dva_name TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tx(id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, descr TEXT, amount INTEGER,
 status TEXT, ref TEXT UNIQUE, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY, network TEXT, label TEXT, price INTEGER, service_id TEXT, variation TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS sells(id INTEGER PRIMARY KEY, user_id INTEGER, network TEXT, gb REAL, phone TEXT, status TEXT DEFAULT 'pending', created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);`);
if (!db.prepare("SELECT 1 FROM plans").get()) {
  const ins = db.prepare("INSERT INTO plans(network,label,price,service_id,variation) VALUES(?,?,?,?,?)");
  // EDIT variation codes in the Developer panel to match your provider's catalogue
  [["MTN","1GB · 30 days",290,"mtn-data","mtn-1gb"],["MTN","2GB · 30 days",580,"mtn-data","mtn-2gb"],
   ["Airtel","1.5GB · 30 days",950,"airtel-data","airtel-1-5gb"],["Glo","2.9GB · 30 days",900,"glo-data","glo-2-9gb"],
   ["9mobile","1.5GB · 30 days",900,"etisalat-data","eti-1-5gb"]].forEach(p => ins.run(p[0],p[1],p[2]*100,p[3],p[4]));
}

// ---------- Email (SMTP). Without SMTP settings, emails are logged and skipped ----------
const port = +(E.SMTP_PORT || 465);
const mailer = E.SMTP_HOST ? nodemailer.createTransport({ host: E.SMTP_HOST, port, secure: port === 465, auth: { user: E.SMTP_USER, pass: E.SMTP_PASS } }) : null;
const fmt = k => "₦" + (k / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 });
async function mail(to, subject, lines) {
  if (!mailer) return console.log("[email skipped: SMTP not set]", to, subject);
  try { await mailer.sendMail({ from: E.MAIL_FROM || E.SMTP_USER, to, subject, text: lines.join("\n").replace(/<[^>]+>/g, ""),
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:22px;border:1px solid #E4DACB;border-radius:14px;background:#FDFAF5;color:#2B2622"><h2 style="color:#B85C3C;margin:0 0 14px">DATA 4 UMMAH</h2>${lines.map(l => `<p style="margin:8px 0">${l}</p>`).join("")}<p style="color:#7A6F66;font-size:12px;margin-top:18px">by Olugbon</p></div>` });
  } catch (e) { console.error("mail error:", e.message); }
}
// Credit a wallet exactly once per reference, then email the receipt
function creditWallet(u, amount, ref, how) {
  let fresh = false;
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM tx WHERE ref=?").get(ref)) return;
    db.prepare("INSERT INTO tx(user_id,type,descr,amount,status,ref) VALUES(?,?,?,?,?,?)").run(u.id, "Wallet funding", how, amount, "Success", ref);
    db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(amount, u.id); fresh = true;
  })();
  if (fresh) { const b = db.prepare("SELECT balance FROM users WHERE id=?").get(u.id).balance;
    mail(u.email, "Wallet funded: " + fmt(amount), [`Hi ${u.name},`, `We received <b>${fmt(amount)}</b> by ${how}.`, `Your new balance is <b>${fmt(b)}</b>.`, `Reference: ${ref}`]); }
  return fresh;
}
// Ask Paystack if the payment really succeeded, then credit the right user
async function verifyAndCredit(reference) {
  const v = await fetch(`${PS}/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${E.PAYSTACK_SECRET_KEY}` } }).then(r => r.json());
  if (!v.status || v.data.status !== "success") return null;
  const d = v.data;
  const u = (d.metadata?.user_id && db.prepare("SELECT * FROM users WHERE id=?").get(d.metadata.user_id))
    || db.prepare("SELECT * FROM users WHERE ps_customer=? OR email=?").get(d.customer?.customer_code || "", (d.customer?.email || "").toLowerCase());
  if (!u) return null;
  creditWallet(u, d.amount, d.reference, d.channel === "dedicated_nuban" ? "bank transfer" : "card/bank checkout");
  return d.amount;
}
const setting = (k, d) => (db.prepare("SELECT v FROM settings WHERE k=?").get(k) || { v: d }).v;
const naira = k => k / 100, kobo = n => Math.round(Number(n) * 100);
const pub = u => ({ id:u.id, name:u.name, email:u.email, phone:u.phone, admin:!!u.admin, balance:naira(u.balance), cashback:naira(u.cashback),
  dva: u.dva_number ? { number:u.dva_number, bank:u.dva_bank, name:u.dva_name } : null });

const app = express();
app.set("trust proxy", 1);
app.get("/health", (q, r) => r.send("ok"));
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use("/api", cors({ origin: ["capacitor://localhost", "https://localhost", "http://localhost"] }));
// Paystack webhook needs the RAW body for signature checking
app.post("/api/paystack/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const sig = crypto.createHmac("sha512", E.PAYSTACK_SECRET_KEY || "").update(req.body).digest("hex");
  if (sig !== req.headers["x-paystack-signature"]) return res.sendStatus(401);
  res.sendStatus(200);
  try {
    const ev = JSON.parse(req.body.toString()), d = ev.data || {};
    const findUser = () => db.prepare("SELECT * FROM users WHERE ps_customer=? OR email=?").get(d.customer?.customer_code || "", (d.customer?.email || "").toLowerCase());
    if (ev.event === "dedicatedaccount.assign.success") {
      const u = findUser(), a = d.dedicated_account || {};
      if (u) db.prepare("UPDATE users SET ps_customer=?, dva_number=?, dva_bank=?, dva_name=? WHERE id=?")
        .run(d.customer.customer_code, a.account_number, a.bank?.name, a.account_name, u.id);
    }
    if (ev.event === "charge.success") await verifyAndCredit(d.reference);
  } catch (e) { console.error("webhook", e); }
});
app.use(express.json());
app.use("/api/auth", rateLimit({ windowMs: 15*60*1000, max: 40 }));
const sign = u => jwt.sign({ id: u.id }, E.JWT_SECRET, { expiresIn: "30d" });
const auth = (req, res, next) => { try {
  req.user = db.prepare("SELECT * FROM users WHERE id=?").get(jwt.verify((req.headers.authorization||"").slice(7), E.JWT_SECRET).id);
  if (!req.user) throw 0; next(); } catch { res.status(401).json({ error: "Please log in again" }); } };
const admin = (req, res, next) => req.user.admin ? next() : res.status(403).json({ error: "Developers only" });
const wrap = f => (req, res) => Promise.resolve(f(req, res)).catch(e => res.status(400).json({ error: e.message || "Something went wrong" }));

app.post("/api/auth/register", wrap((req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !/^\S+@\S+$/.test(email||"") || !/^0\d{10}$/.test(phone||"") || (password||"").length < 6) throw new Error("Check your name, email, 11-digit phone and a password of 6+ characters");
  const isAdmin = E.ADMIN_EMAIL && email.toLowerCase() === E.ADMIN_EMAIL.toLowerCase() ? 1 : 0;
  try { const r = db.prepare("INSERT INTO users(name,email,phone,pass,admin) VALUES(?,?,?,?,?)").run(name.trim(), email.toLowerCase(), phone, bcrypt.hashSync(password, 10), isAdmin);
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(r.lastInsertRowid); res.json({ token: sign(u), user: pub(u) });
  } catch { throw new Error("That email is already registered"); } }));
app.post("/api/auth/login", wrap((req, res) => {
  const u = db.prepare("SELECT * FROM users WHERE email=?").get((req.body.email||"").toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password||"", u.pass)) throw new Error("Wrong email or password");
  res.json({ token: sign(u), user: pub(u) }); }));

app.get("/api/me", auth, (req, res) => res.json({ user: pub(req.user), note: setting("note", "Welcome to DATA 4 UMMAH.") }));
app.get("/api/plans", auth, (req, res) => res.json(db.prepare("SELECT id,network,label,price FROM plans WHERE active=1").all().map(p => ({ ...p, price: naira(p.price) }))));
app.get("/api/tx", auth, (req, res) => res.json(db.prepare("SELECT * FROM tx WHERE user_id=? ORDER BY id DESC LIMIT 100").all(req.user.id).map(t => ({ ...t, amount: naira(t.amount) }))));

// Generate the user's Paystack dedicated virtual account (async: result arrives by webhook)
app.post("/api/fund/account", auth, wrap(async (req, res) => {
  const u = req.user; if (u.dva_number) return res.json({ user: pub(u) });
  const [first, ...rest] = u.name.split(" ");
  const r = await fetch(`${PS}/dedicated_account/assign`, { method: "POST",
    headers: { Authorization: `Bearer ${E.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.email, first_name: first, last_name: rest.join(" ") || first, phone: u.phone, preferred_bank: E.PAYSTACK_BANK || "wema-bank", country: "NG" }) }).then(x => x.json());
  if (!r.status) throw new Error(r.message || "Paystack could not create the account");
  res.json({ pending: true, message: "Creating your account. This takes a few seconds." }); }));


// Pay by card / bank checkout (Paystack hosted page), then credit and email
app.post("/api/fund/card", auth, wrap(async (req, res) => {
  const a = Number(req.body.amount);
  if (!(a >= 100 && a <= 1000000)) throw new Error("Enter an amount from ₦100 to ₦1,000,000");
  const r = await fetch(`${PS}/transaction/initialize`, { method: "POST", headers: { Authorization: `Bearer ${E.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: req.user.email, amount: kobo(a), reference: "FND" + Date.now() + crypto.randomBytes(3).toString("hex"), callback_url: (E.APP_URL || "") + "/", metadata: { user_id: req.user.id } }) }).then(x => x.json());
  if (!r.status) throw new Error(r.message || "Could not start the payment");
  res.json({ url: r.data.authorization_url }); }));
app.post("/api/fund/verify", auth, wrap(async (req, res) => {
  const amt = await verifyAndCredit(req.body.reference || ""); res.json({ credited: !!amt, amount: amt ? naira(amt) : 0 }); }));

// VTU provider (VTpass adapter). Swap this function if you use another provider.
async function vtu({ serviceId, variation, phone, amount }) {
  if (E.MOCK_VTU !== "false") return { ok: true, ref: "MOCK" + Date.now() };
  const lagos = new Date(Date.now() + 3600e3).toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const body = { request_id: lagos + crypto.randomBytes(4).toString("hex"), serviceID: serviceId, billersCode: phone, phone, amount: Math.round(amount) };
  if (variation) body.variation_code = variation;
  const r = await fetch(`${E.VTPASS_BASE}/api/pay`, { method: "POST", headers: { "api-key": E.VTPASS_API_KEY, "secret-key": E.VTPASS_SECRET_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(x => x.json());
  const st = r.content?.transactions?.status;
  return { ok: r.code === "000" && st !== "failed", ref: body.request_id, raw: r };
}
async function purchase(user, type, descr, cost, call) {
  const ref = "TX" + Date.now() + crypto.randomBytes(3).toString("hex");
  const paid = db.prepare("UPDATE users SET balance=balance-? WHERE id=? AND balance>=?").run(cost, user.id, cost);
  if (!paid.changes) throw new Error("Balance too low. Fund your wallet first.");
  let ok = false; try { ok = (await call()).ok; } catch (e) { console.error(e); }
  if (!ok) { db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(cost, user.id); // auto-refund
    db.prepare("INSERT INTO tx(user_id,type,descr,amount,status,ref) VALUES(?,?,?,?,?,?)").run(user.id, type, descr, cost, "Failed (refunded)", ref); mail(user.email, "Purchase failed, money refunded", [`Hi ${user.name},`, `Your ${type.toLowerCase()} (${descr}) could not be completed.`, `We refunded <b>${fmt(cost)}</b> to your wallet.`]);
    throw new Error("Purchase failed. You were not charged."); }
  db.prepare("UPDATE users SET cashback=cashback+? WHERE id=?").run(Math.round(cost * 0.01), user.id);
  db.prepare("INSERT INTO tx(user_id,type,descr,amount,status,ref) VALUES(?,?,?,?,?,?)").run(user.id, type, descr, cost, "Success", ref);
  const bal = db.prepare("SELECT balance FROM users WHERE id=?").get(user.id).balance;
  mail(user.email, type + " successful", [`Hi ${user.name},`, `${descr}`, `Amount: <b>${fmt(cost)}</b>. Balance: <b>${fmt(bal)}</b>.`, `Reference: ${ref}`]);
}
app.post("/api/buy/data", auth, wrap(async (req, res) => {
  const p = db.prepare("SELECT * FROM plans WHERE id=? AND active=1").get(req.body.planId), ph = req.body.phone;
  if (!p || !/^0\d{10}$/.test(ph||"")) throw new Error("Choose a plan and enter a valid phone number");
  await purchase(req.user, "Data purchase", `${p.network} ${p.label} → ${ph}`, p.price, () => vtu({ serviceId: p.service_id, variation: p.variation, phone: ph, amount: p.price / 100 }));
  res.json({ ok: true }); }));
const AIR = { MTN: "mtn", Airtel: "airtel", Glo: "glo", "9mobile": "etisalat" };
app.post("/api/buy/airtime", auth, wrap(async (req, res) => {
  const { network, phone, amount } = req.body, a = Number(amount);
  if (!AIR[network] || !/^0\d{10}$/.test(phone||"") || !(a >= 50 && a <= 50000)) throw new Error("Check network, phone number and amount (₦50 to ₦50,000)");
  await purchase(req.user, "Airtime purchase", `${network} → ${phone}`, kobo(a), () => vtu({ serviceId: AIR[network], phone, amount: a }));
  res.json({ ok: true }); }));
app.post("/api/sell", auth, wrap((req, res) => { const { network, gb, phone } = req.body;
  if (!network || !(gb > 0) || !phone) throw new Error("Fill in all fields");
  db.prepare("INSERT INTO sells(user_id,network,gb,phone) VALUES(?,?,?,?)").run(req.user.id, network, gb, phone); res.json({ ok: true }); }));

// Developer/Admin
const A = express.Router(); A.use(auth, admin); app.use("/api/admin", A);
A.get("/overview", (q, r) => r.json({
  users: db.prepare("SELECT id,name,email,phone,balance,admin,created FROM users ORDER BY id DESC").all().map(u => ({ ...u, balance: naira(u.balance) })),
  plans: db.prepare("SELECT * FROM plans").all().map(p => ({ ...p, price: naira(p.price) })),
  sells: db.prepare("SELECT s.*,u.name FROM sells s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC").all(), note: setting("note", "") }));
A.put("/note", wrap((q, r) => { db.prepare("INSERT INTO settings(k,v) VALUES('note',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(q.body.note || ""); r.json({ ok: true }); }));
A.post("/plans", wrap((q, r) => { const b = q.body; db.prepare("INSERT INTO plans(network,label,price,service_id,variation) VALUES(?,?,?,?,?)").run(b.network, b.label, kobo(b.price), b.service_id, b.variation); r.json({ ok: true }); }));
A.put("/plans/:id", wrap((q, r) => { const b = q.body; db.prepare("UPDATE plans SET price=COALESCE(?,price), variation=COALESCE(?,variation), active=COALESCE(?,active) WHERE id=?")
  .run(b.price == null ? null : kobo(b.price), b.variation ?? null, b.active ?? null, q.params.id); r.json({ ok: true }); }));
A.delete("/plans/:id", wrap((q, r) => { db.prepare("DELETE FROM plans WHERE id=?").run(q.params.id); r.json({ ok: true }); }));
A.post("/credit", wrap((q, r) => { const amt = kobo(q.body.amount), id = q.body.userId; if (!amt || !id) throw new Error("User and amount required");
  db.transaction(() => { db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(amt, id);
    db.prepare("INSERT INTO tx(user_id,type,descr,amount,status,ref) VALUES(?,?,?,?,?,?)").run(id, "Admin credit", "Developer credit", amt, "Success", "ADM" + Date.now()); })();
  const t = db.prepare("SELECT * FROM users WHERE id=?").get(id); if (t) mail(t.email, "Wallet credited: " + fmt(amt), [`Hi ${t.name},`, `<b>${fmt(amt)}</b> was added to your wallet.`, `New balance: <b>${fmt(t.balance)}</b>.`]);
  r.json({ ok: true }); }));
A.put("/sells/:id", wrap((q, r) => { db.prepare("UPDATE sells SET status=? WHERE id=?").run(q.body.status, q.params.id); r.json({ ok: true }); }));

app.use(express.static(path.join(__dirname, "public")));
app.listen(E.PORT || 3000, () => console.log("DATA 4 UMMAH running on port " + (E.PORT || 3000)));
