# OneMart

Everything you need, in one place. — a hypermarket e-commerce platform:
browse → product page → cart → checkout → order confirmation → order history, plus a
staff admin console for catalogue, stock, order, and review management.

Phase 1 (foundation + storefront) is complete. Phase 2 lands one step per commit:
✅ design system → ✅ pricing engine + coupons/discounts → ✅ reviews → ✅ wishlist →
✅ order timeline + cancellation → notifications → admin discounts screens →
admin reports.

Modular monolith, not microservices: one FastAPI app with clear module boundaries
(catalog, cart, orders, inventory, discounts, reviews, audit, users), a React SPA,
PostgreSQL, and Redis.

## Stack

| Layer     | Tech |
|-----------|------|
| API       | FastAPI, SQLAlchemy 2.0 (typed ORM), Alembic, Pydantic v2 |
| DB        | PostgreSQL 16 (Docker Compose, `127.0.0.1:5433`) |
| Cache     | Redis 7 (Docker Compose, internal only — not published; falls back to an in-process cache when unreachable) |
| Frontend  | React 19, Vite 6, TypeScript (strict), Tailwind CSS v4, React Router 7 |
| Data/Auth | TanStack Query (server state), Zustand (auth state), JWT access token + httpOnly refresh cookie |
| Tooling   | Ruff, pytest, Docker Compose, puppeteer-core + Playwright for E2E |

## Feature scope

**Customer**

- Homepage: hero, departments, featured/best-selling sections, category shortcuts, search
- Catalogue: category/subcategory browse, keyword search, brand/price/in-stock filters,
  sorting, pagination — all driven by the API
- Product detail: image gallery, variant picker (size/weight/pack), price + compare-at,
  stock state, quantity stepper, add to cart
- Cart: quantity updates, removal, delivery-fee maths (free over ₹999, else ₹40)
- Checkout: saved/new delivery addresses, Cash on Delivery only, order note,
  order summary — payment sits behind a `PaymentProvider` registry
  (`backend/app/modules/orders/payment.py`) so another gateway can be added without
  touching order logic
- Orders: history list with status/sort filters, order detail with a vertical status
  timeline replayed from the append-only `OrderStatusHistory` (status, timestamp and
  note per step, the current step highlighted, future steps muted, cancelled ending in
  a terminal red step), plus cancellation while the order is still Pending/Confirmed —
  stock returns to the shelf in the same transaction that writes the history row
- Auth: register/login, JWT access token in memory, rotating httpOnly refresh cookie,
  silent refresh on 401, guest cart merged into the account on login
- Pricing: cart/checkout/confirmation totals all come from one server-side pricing
  engine (base price → best automatic discount → coupon → delivery fee); coupons with
  inline success/rejection reasons, struck-through original prices + deal badges
- Reviews: rating summary with star-distribution bars, sortable + paginated list,
  write/edit/delete one's own review, `verified_purchase` computed from a delivered
  order, login prompt for guests, helpful votes
- Wishlist: heart toggle on cards and the product page (optimistic, rolls back on
  error), account wishlist grid with sort/search/in-stock filter, add to cart with a
  variant picker, live price + stock per saved item; guests get a login prompt and
  their tap is replayed into the wishlist once they sign in

**Admin** (staff/admin role)

- Product CRUD (draft/publish, variants, images, per-variant stock)
- Category CRUD (self-referencing tree with parent/child)
- Manual stock adjustments per variant (signed deltas with reasons)
- Order list + detail with status updates restricted to a server-enforced
  valid-transitions map (`pending → confirmed → packed → shipped → delivered`,
  cancellations where allowed — no skipping or stepping back), optional note per
  move written to the timeline, each staff change appended to the `audit_logs` trail
- Coupons CRUD (percent/flat/free-delivery, validity window, usage limits)
- Review moderation: filter by rating/status/search, hide/unhide + delete,
  each moderation action written to the `audit_logs` trail

**Concurrency:** checkout locks inventory rows with `SELECT … FOR UPDATE` and creates the
order in the *same* transaction — stock is never checked and the order created as
separate steps. Covered by a race test (two concurrent checkouts → exactly one `201`,
one `409`).

**Still ahead (Phase 2):** notifications, admin discounts screens, admin reports
dashboard.

**Not built by design:** flash deals, promotional banner engine, related /
frequently-bought-together, online payment gateway (COD + `PaymentProvider` seam only),
recommendations — all Phase 3.

## Quick start (Docker Compose)

```powershell
docker compose up --build
```

- Web (Vite dev): http://127.0.0.1:5173
- API (FastAPI + auto docs): http://127.0.0.1:8000/docs
- DB: `127.0.0.1:5433` — Redis: not published (compose network only; see
  `docker-compose.override.example.yml` to expose it on `127.0.0.1:17500`)

The API container runs `alembic upgrade head` and seeds demo data on first start.
`backend/` and `frontend/` are bind-mounted, so host edits hot-reload
(uvicorn `--reload` for the API, Vite HMR for the SPA). All published ports bind
to `127.0.0.1` only.

## Quick start (local development)

Prereqs: Python 3.12+, Node 20+, Docker (for Postgres/Redis).

```powershell
# 1. infrastructure
docker compose up -d db redis

# 2. backend
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -e ".[dev]"
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\python -m app.seed        # seed demo catalogue + accounts
.\.venv\Scripts\uvicorn app.main:app --reload --port 8000

# 3. frontend (new terminal)
cd frontend
npm install
npm run dev                                 # http://localhost:5173, proxies /api → :8000
```

## Demo accounts

| Role     | Email               | Password    |
|----------|---------------------|-------------|
| Admin    | `admin@onemart.test`| `Admin@1234`|
| Staff    | `staff@onemart.test`| `Staff@1234`|
| Customer | `demo@onemart.test` | `Demo@1234` |

## Commands

```powershell
# backend
cd backend
.\.venv\Scripts\python -m pytest -q          # 71 tests (auth, catalog, cart merge, checkout race, orders + transitions/cancellation, admin, pricing + coupons, reviews, wishlist)
.\.venv\Scripts\python -m ruff check app tests
.\.venv\Scripts\python -m app.seed           # seed demo data (no-op if already seeded)

# frontend
cd frontend
npm run dev                                  # Vite dev server
npm run build                                # tsc --noEmit + vite build
npx tsc --noEmit                             # typecheck only
node scripts/smoke.mjs                       # full E2E smoke (needs dev servers running)
node scripts/responsive.mjs                  # mobile/tablet screenshots
npm run test:e2e                             # Playwright flow (needs dev servers running)
```

`scripts/smoke.mjs` drives Chrome (puppeteer-core) through the entire slice on both sides:
home → browse → sort → product → add to cart → guest taps the wishlist heart (login prompt) →
checkout → login → place order → order history → wishlist (guest tap replayed after login,
add to cart, remove) → admin login → product list/edit → stock → orders → status update →
customer timeline → customer cancels the order (terminal step + history note) → ratings
section → customer writes a review → admin hides/deletes it → the review disappears for the
customer. It screenshots every step (temp dir path printed at the end) and exits non-zero
on any failure or console/API error.

`tests/e2e/checkout-coupon-flow.spec.ts` is the Phase 2 pricing flow in one Playwright test:
a signed-in customer adds a product, applies a coupon, checks out at the discounted total;
an admin confirms the order with a note; the customer's own order payload and timeline show
both. It runs against the same running stack and uses the installed Chrome
(`channel: "chrome"`, no browser download).

## API conventions

- Base path `/api`; the Vite dev server proxies `/api` → `http://localhost:8000`
  (same-origin so the refresh cookie works; override with `VITE_API_BASE_URL`).
- Errors are always `{"error": {"code", "message", "details"}}` (HTTP status + envelope),
  with Pydantic field errors in `details` for validation failures.
- List endpoints (`/products`, `/admin/products`, `/orders`, `/admin/orders`,
  `/admin/inventory`, `/products/{slug}/reviews`, `/admin/reviews`, `/wishlist`) take
  `page`, `page_size`, plus endpoint-specific `q` / `category` / `brand` / `in_stock` /
  `status` / `rating` filters and a `sort` whitelist.
- Health: `GET /api/health`. Placeholder product images: `GET /api/img/placeholder.svg`.

## Project layout

```
backend/
  app/core/           config, db, security (JWT), exceptions, redis cache
  app/modules/
    users/            auth (JWT + httpOnly refresh), addresses, roles
    catalog/          categories, brands, products, variants, images, admin CRUD
    cart/             cart resolution (guest cookie ↔ account), merge, items
    inventory/        per-variant stock, admin adjustments
    orders/           checkout (FOR UPDATE), status history + transition rules,
                      customer cancellation (same-transaction restock), payment registry
    discounts/        pricing engine (Decimals), coupons + redemptions, auto-clear
    reviews/          reviews + helpful votes, rating summary recompute, moderation
    wishlist/         saved products per customer (idempotent toggle, live price/stock)
    audit/            shared audit trail (`record()` joins the caller's transaction)
  app/seed.py         demo catalogue + accounts
  tests/              pytest suite (uses onemart_test DB, REDIS_DISABLED)
frontend/
  src/lib/            typed API client, query keys, formatting (INR), types
  src/hooks/queries/  TanStack Query hooks (catalog, cart, checkout, orders, reviews, wishlist, admin)
  src/stores/auth.ts  Zustand auth store
  src/components/     ui primitives, layout shells, catalog/orders/reviews components
  src/pages/          customer pages + admin pages
  scripts/            E2E smoke + responsive screenshot tools
  tests/e2e/          Playwright flow test (pricing + coupons end to end)
```

## Design system

Defined as CSS variables on `:root` in `frontend/src/index.css` **and** mapped in
`frontend/tailwind.config.ts`, so components only ever use tokens — no hardcoded colors,
no dark mode.

- **Palette:** ~70% neutrals (`canvas #FAF8F4`, `surface` white/`surface-2`, `line`,
  `ink`/`ink-muted`/`ink-faint`), ~20% brand greens (`brand-50…900`, primary buttons are
  `brand-700` with white text, hover `brand-800`), ~10% deal (`deal-600`) — deal red-orange
  is reserved for sale prices and discount badges; errors use `danger #C62F2F`
- **Accents:** `highlight #FFD84D` at most once per screen (coupon chip / promo strip),
  never on buttons; dark surfaces (header, footer, admin sidebar) are `brand-900`
- **Statuses:** one shared `<StatusBadge/>` — pending `#9A9E96`, confirmed `#2563A8`,
  packed/processing `#E9A100`, shipped/out-for-delivery `#0F5C3A`, delivered `#1F8A4C`,
  cancelled `#C62F2F` (soft tint chip + colored dot + `ink` label)
- **Type:** Inter, one type scale; tabular numerals (`.num`) for prices; `.label`
  small-caps eyebrow style
- **Shape:** page bg = canvas, cards = white + 1px `line` border, 6–8px radii,
  hairline borders, no heavy shadows, no gradients
- **States:** skeletons (never spinners) for loading, designed empty/error states on
  every screen; fully responsive layout (mobile drawer nav, 2→3→4 column grids)

Currency is formatted as INR with `en-IN` locale throughout.

## Notes

- `JWT_SECRET` in `docker-compose.yml` is a development value — replace it anywhere real.
- Guest carts live behind an httpOnly `om_cart` cookie and are merged into the account on
  login/refresh (relationship-aware merge so delete-orphan cascades never drop items).
- Order statuses are append-only history rows; the list/detail views replay them into a
  timeline and only the server-enforced valid-transitions map can move an order (no
  skipping or stepping back). Customers may cancel while Pending/Confirmed — stock is
  restored in the same transaction that writes the history row; staff status changes are
  appended to the audit log.
- `product.rating_avg` / `rating_count` are denormalized and recomputed inside the same
  transaction as every review write/edit/delete; hidden reviews leave the public list
  *and* the average. The cached product-detail payload carries the live summary.
