# ShopNest

A production-oriented full-stack e-commerce application built with React, Node.js, Express and
MongoDB — an original brand inspired by large Indian marketplaces, not affiliated with or
copying any existing brand's branding, logo, or design.

"Production-oriented" here means: the things that would actually bite you in a real deployment
(overselling stock under concurrent checkouts, trusting the client for prices, a missing env
var causing a confusing runtime error instead of a clear one) have been addressed. It does not
mean "enterprise-grade" or "battle-tested at scale" — see **Known limitations** at the bottom
for what that would still take.

> **Payments are simulated.** No real payment gateway is contacted and no real money is ever
> charged, by design — see "Demo payment" below.

---

## Features

- Product catalog with search, filters (category, price, rating, brand, availability), sorting
  and backend pagination
- Product details with image gallery, variants, quantity selector and related products
- Cart that persists on the server for logged-in users and in `localStorage` for guests
- JWT authentication with bcrypt password hashing, plus a real password-reset flow (hashed,
  expiring tokens emailed to the user — not a fake "check your email" message)
- Saved delivery addresses (add / edit / delete / select at checkout)
- Multi-step checkout: address → order summary → demo payment
- Demo payment methods: Demo UPI, Demo Card (fixed test card number), Cash on Delivery
- Order creation with server-side price verification, atomic stock reservation, and duplicate-
  submission protection (see "How order creation actually works" below)
- Order confirmation email via Nodemailer (HTML, responsive) — skipped gracefully, without
  crashing the order flow, if email isn't configured
- Order history, order details with a status progress indicator
- Admin dashboard: manage products (add/edit/remove) and update order status
- Responsive design (360px → 1440px+), loading skeletons, empty states, toasts, confirm dialogs
- Rate limiting on auth/payment endpoints, security headers via Helmet, a health check endpoint,
  and graceful shutdown on SIGTERM/SIGINT
- 41 seeded products across 9 categories with realistic ₹ pricing
- A unit test suite covering pricing math, validation, auth middleware and error handling

## Architecture

```
shopnest/
├── client/                  # React + Vite frontend
│   └── src/
│       ├── components/      # Header, Footer, ProductCard, ProductImage, forms, dialogs…
│       ├── pages/           # Route-level pages, including admin/
│       ├── layouts/         # MainLayout wrapper
│       ├── context/         # AuthContext, CartContext, ToastContext
│       └── services/        # Axios client
├── server/                  # Express backend
│   ├── config/               # DB connection
│   ├── controllers/          # Route handlers — the actual business logic
│   ├── middleware/           # auth, rate limiting, error handling
│   ├── models/                # Mongoose schemas
│   ├── routes/                 # Express routers (thin — just wiring)
│   ├── seed/                    # Seed script + 41 product dataset
│   ├── tests/
│   │   ├── unit/                  # No database required — run with `npm test`
│   │   └── integration/            # Real HTTP + real MongoDB — see "Testing" below
│   └── utils/                       # JWT helper, pricing math, email sender + template
├── .env.example
├── .gitignore
└── README.md
```

**Why this stack:** MongoDB's document model fits a product catalog with per-category variable
fields (specifications, variants) more naturally than forcing every product into the same rigid
columns a relational schema would need. Express + a plain controller/route split keeps the
backend easy to trace end to end without an ORM-style service-layer abstraction on top of
Mongoose that this project's size doesn't need. JWT (rather than server-side sessions) keeps the
backend stateless, which matters if it's ever deployed behind more than one instance.

## How authentication actually works

- Passwords are hashed with bcrypt in a Mongoose `pre('save')` hook on `User` — never stored or
  returned in plaintext. `toSafeObject()` strips the hash (and password-reset fields) before any
  user object goes back to the client.
- On login, the server signs a JWT (`JWT_SECRET`, expiring per `JWT_EXPIRES_IN`) and returns it
  in the JSON body. The client stores it in `localStorage` and sends it as
  `Authorization: Bearer <token>` on every request via an Axios interceptor.
- Protected routes run through `protect` middleware, which verifies the JWT and loads the user;
  admin routes additionally run `adminOnly`, which checks `req.user.role === 'admin'`. Both are
  enforced server-side — hiding a button in the UI is not how admin access is actually protected.
- **Password reset:** requesting a reset always returns the same generic message, whether or not
  the email exists, so the endpoint can't be used to enumerate registered accounts. If the
  account exists, a random 32-byte token is generated, only its SHA-256 hash is stored (with a
  30-minute expiry), and the raw token is emailed as a reset link. The reset endpoint hashes the
  incoming token and looks up a non-expired match — same principle as the password itself, never
  store the secret you'll need to compare against later in a reversible form.

## How order creation actually works

This is the part of the app most worth understanding, because it's where most real e-commerce
bugs live.

1. **Prices and totals are never trusted from the client.** `createOrder` re-fetches every cart
   item's product from MongoDB and recalculates subtotal/discount/delivery/total from
   `utils/pricing.js` — the same function the cart preview uses, so what a user sees in their
   cart and what they're charged come from one shared calculation, not two copies that could
   drift apart.
2. **Stale-cart detection.** The client sends the total it displayed on the payment screen
   (`expectedTotal`). If that no longer matches what the server just calculated — a price
   changed, someone else bought the last unit — the server responds `409` with *"Some items in
   your cart have changed. Please review your cart before placing the order."* instead of
   silently charging a different amount. The server's own calculation is still what determines
   the real total; `expectedTotal` is only used for this staleness check.
3. **Atomic stock reservation.** Stock is decremented with a single conditional update per item —
   `findOneAndUpdate({ _id, stock: { $gte: quantity } }, { $inc: { stock: -quantity } })` — so
   two concurrent checkouts for the last unit can't both succeed. If any item in a multi-item
   cart fails to reserve, everything already reserved in that attempt is put back before
   returning the error. (This isn't a multi-document MongoDB transaction — that needs a replica
   set, which a single local `mongod` doesn't run by default. Atlas gives you one for free; on a
   replica set, wrapping this in a real transaction would be the next step.)
4. **Duplicate-submission protection.** The client generates one `clientRequestId` per checkout
   attempt (not per click) and sends it with the order. If the same id arrives again — a retried
   request after a flaky network response, an accidental double-click that got past the
   disabled-button guard — the server returns the *original* order instead of creating a second
   one. A race where two identical requests land at almost the same instant is caught by a
   unique index on `clientRequestId` in the database itself, not just application logic.
5. **Email never blocks the order.** `sendEmail()` returns `{ sent: false }` instead of throwing
   if SMTP isn't configured or fails, so a broken mail server can't turn a successful order into
   a failed one. The order success page tells the user honestly whether the email went out.

## Demo payment

Checkout never contacts a real payment processor — this is explicit by design, not a shortcut.
**Nothing about this flow is production payment processing.** It is a simulator, built so that a
real gateway can later replace the simulator without changing how orders are verified.

- **Demo UPI** — any fake UPI ID in the form `name@upi`
- **Demo Card** — must use the fixed test card `4111 1111 1111 1111`, any future expiry (e.g.
  `12/30`), any 3–4 digit CVV
- **Cash on Delivery** — no payment details required

How it works:

1. `POST /api/payment/demo` calculates the amount **on the server** from the user's cart (same
   pricing code as checkout; the request cannot set an amount or a status) and stores a `Payment`
   record: user, amount, currency, method, status, and a hash of the cart that was paid for. The
   record is marked `simulated: true`. A failed attempt is stored as `Failed` with a static reason —
   card numbers, CVVs and UPI IDs are never stored.
2. It returns the record's server-issued reference as `transactionId`.
3. `POST /api/orders` does **not** trust that value as proof of anything. It looks the reference up
   in the `Payment` records and only accepts a payment that belongs to the same user, used the same
   method, `Succeeded`, hasn't expired (15 minutes) or been used, and whose amount and cart hash
   match the order being placed now. The payment is claimed atomically, so it can back at most one
   order (a unique index on `Order.payment` backs this up). If stock can't be reserved, the claim is
   released so the customer can retry without paying again.
4. The order stores the payment link, the reference and `paymentSimulated: true`. `paymentStatus`
   is set only by the server, never from the request.

"Pay & Place Order" simulates a ~1.2 second processing delay. The checkout screen is clearly
labeled **"DEMO PAYMENT — NO REAL MONEY WILL BE CHARGED."**

## Security measures

- Passwords hashed with bcrypt; JWTs signed with an environment-provided secret and an expiry
- Helmet for security headers (CSP disabled deliberately — this API serves JSON to a separate
  frontend origin, so CORS is the real cross-origin boundary, not a same-origin CSP)
- CORS restricted to `CLIENT_URL`, not `*`
- Rate limiting on `/auth/*` and `/payment/demo` (configurable via env, sensible defaults)
- Server-side authorization on every sensitive route (`protect`/`adminOnly`) — never just a
  hidden UI element
- Server-side validation on auth, address, product and order inputs; malformed requests get a
  `400` with a specific message, never a raw stack trace
- Server-side price/stock verification and atomic stock updates (see above)
- The app refuses to start if `JWT_SECRET` or `MONGO_URI` is missing, rather than starting in a
  broken state and failing confusingly on the first request
- No sensitive identifiers (card numbers, CVV, SMTP passwords) ever get logged or stored

## Testing

Two tiers, in `server/tests/`:

- **`tests/unit/`** — no database required. Covers the pricing math, address/product
  validation, the auth middleware (with a mocked `User` model), and the centralized error
  handler's status-code mapping. Run with:

  ```bash
  cd server
  npm test
  ```

  This is around 150 tests and takes a few seconds.

- **`tests/integration/`** — real HTTP requests via supertest against the actual Express app,
  with a real MongoDB connection (register → login → protected route, product listing +
  pagination, admin authorization rejection for a non-admin). These need a **throwaway**
  database — they wipe their collections between test runs:

  ```bash
  cd server
  MONGO_URI_TEST=mongodb://127.0.0.1:27017/shopnest_test npm run test:integration
  ```

  If `MONGO_URI_TEST` isn't set, this suite reports itself as **skipped**, not passed — it does
  not pretend to have verified anything it didn't actually run.

## Prerequisites

- Node.js 18+
- npm
- A MongoDB instance — either a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster or
  a local MongoDB server
- (Optional, for real emails) SMTP credentials — e.g. a Gmail account with an
  [app password](https://support.google.com/accounts/answer/185833), or any SMTP provider
  (Mailtrap, Brevo, SES, etc.)

## Installation

```bash
cd server && npm install
cd ../client && npm install
```

## Environment variables

```bash
cd server
cp .env.example .env
```

| Variable | Description |
|---|---|
| `PORT` | Port the API runs on (default `5000`) |
| `NODE_ENV` | `development`, `production`, or `test` |
| `CLIENT_URL` | Frontend origin — used for CORS **and** for building the password-reset link sent by email |
| `MONGO_URI` | Your MongoDB connection string. **Required** — the app refuses to start without it |
| `JWT_SECRET` | A long random string used to sign auth tokens. **Required** — the app refuses to start without it |
| `JWT_EXPIRES_IN` | Token lifetime (default `7d`) |
| `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASSWORD` / `EMAIL_FROM` | SMTP settings for order confirmation and password-reset emails |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Credentials for the admin account created by the seed script. `ADMIN_PASSWORD` is **required** outside local development (see "Seeding the database") |
| `RATE_LIMIT_WINDOW_MINUTES` / `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_PAYMENT_MAX` | Optional — override the default rate limits on auth/payment endpoints |

**Never commit your real `.env` file.** `.gitignore` already excludes it.

If email variables are left blank, the app does **not** crash — it logs a warning and skips
sending, and the order success page / password-reset flow degrade honestly rather than lying
about what happened.

## MongoDB setup

- **Atlas:** create a free cluster, add a database user, allow your IP, and copy the connection
  string into `MONGO_URI` (include a database name, e.g. `.../shopnest?retryWrites=true...`).
- **Local:** install MongoDB Community Server, run `mongod`, and use
  `mongodb://127.0.0.1:27017/shopnest`.

## Database indexes (payments and orders)

The payment and order models rely on unique and partial indexes (one payment per order, no duplicate
webhook events, and so on). Declaring them in a Mongoose schema does **not** guarantee they exist in
the database you deployed to, and a unique index cannot be built over data that already has duplicates.
Before taking real payments, run the check against the real database:

```bash
cd server
npm run indexes:check                                   # read-only report
node scripts/phase1-indexes.js --apply --confirm-db=<database name>   # create what is missing
```

The script only ever creates missing indexes. It never drops one, and it refuses to build a unique index
over duplicate data (it lists the duplicates instead). Run it again after every deploy that changes a model.

## Seeding the database

```bash
cd server
npm run seed          # insert 41 products + create the admin account
npm run seed:destroy   # wipe seed-managed data
```

Creates an admin account using `ADMIN_EMAIL`/`ADMIN_PASSWORD` from `.env`.

- Outside an explicit `NODE_ENV=development` or `test` (that includes `production` and an unset
  `NODE_ENV`), `ADMIN_PASSWORD` is **required** and must be strong: at least 12 characters with
  upper-case, lower-case, a digit and a symbol, and no common words or sequences. The seed aborts
  with a clear error, before connecting to the database, if it is missing or weak.
- In `development`/`test` against a local MongoDB only, a missing `ADMIN_PASSWORD` falls back to a
  development-only default and prints a warning. That fallback is never used for any other
  environment or for a non-local database.
- Passwords are never printed by the seed script.

## Running the app

```bash
# Terminal 1 — backend (http://localhost:5000)
cd server && npm run dev

# Terminal 2 — frontend (http://localhost:5173)
cd client && npm run dev
```

Vite proxies `/api` to `http://localhost:5000` in dev. Visit **http://localhost:5173**.

For production builds:

```bash
cd client && npm run build   # outputs client/dist — deploy as static files
cd server && npm start
```

## Deployment notes

Nothing here is hardcoded to a specific host — configure these once you pick providers:

- **Frontend:** any static host (Vercel, Netlify, Cloudflare Pages…). Build command
  `npm run build`, output directory `client/dist`. Set the API base URL the frontend calls to
  your deployed backend's URL (currently the dev setup relies on Vite's proxy, which only
  applies to `npm run dev` — a production build needs the backend URL configured directly).
- **Backend:** any Node host (Render, Railway, Fly.io, a VPS…). Start command `npm start`,
  working directory `server/`. Set all variables from `.env.example` in the host's environment
  config — the app will refuse to start if `JWT_SECRET`/`MONGO_URI` are missing, which is
  intentional.
- **Database:** MongoDB Atlas (or equivalent managed MongoDB) — a real replica set, which also
  unlocks proper multi-document transactions if the atomic-per-item stock reservation described
  above ever needs to become a true transaction.
- **Email:** a real SMTP provider (Brevo, SES, Postmark…) — the free tier of most of these is
  enough for a small app's order-confirmation volume.
- **CORS:** set `CLIENT_URL` to the deployed frontend's exact origin — the backend does not
  accept `*` for authenticated routes.

## Known limitations

Being upfront about what this is and isn't:

- No image upload pipeline — admin product images are added by URL. `ProductImage` provides a
  fallback for a broken/removed URL so the layout doesn't break, but there's no S3/Cloudinary
  integration.
- No product review submission UI (the `Review` model exists; there's no form for it yet)
- Stock reservation is atomic per item, not across the whole order in one MongoDB transaction —
  see "How order creation actually works" above for why, and what a replica set would enable
- Order numbers (`SN######`) are random 6-digit codes with a uniqueness constraint. A collision
  is very unlikely at this scale; at high volume you'd want a retry loop or a sequential counter
- No automated end-to-end/UI test suite (Cypress/Playwright) — the test suite covers backend
  business logic, not the rendered frontend
- No background job queue — email sending happens inline in the order-creation request. The
  email logic is isolated in `utils/sendEmail.js` specifically so it could move to a queue
  (BullMQ, SQS, etc.) later without touching the order controller's logic
- No CDN/caching layer, no horizontal-scaling configuration — reasonable for a small/medium app,
  not written with 100k concurrent users in mind