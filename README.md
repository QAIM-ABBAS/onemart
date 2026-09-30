# OneMart

Everything you need, in one place. — a hypermarket e-commerce platform (Phase 1):
browse → product page → cart → checkout → order confirmation → order history, plus a
staff admin console for catalogue, stock, and order management.

Modular monolith, not microservices: one FastAPI app with clear module boundaries
(catalog, cart, orders, inventory, users), a React SPA, PostgreSQL, and Redis.

## Stack

| Layer     | Tech |
|-----------|------|
| API       | FastAPI, SQLAlchemy 2.0 (typed ORM), Alembic, Pydantic v2 |
| DB        | PostgreSQL 16 (Docker Compose, `127.0.0.1:5433`) |
| Cache     | Redis 7 (Docker Compose, internal only — not published; falls back to an in-process cache when unreachable) |
| Frontend  | React 19, Vite 6, TypeScript (strict), Tailwind CSS v4, React Router 7 |
| Data/Auth | TanStack Query (server state), Zustand (auth state), JWT access token + httpOnly refresh cookie |
| Tooling   | Ruff, pytest, Docker Compose, puppeteer-core for E2E smoke |

## Feature scope (Phase 1)

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
- Orders: history list with status/sort filters, order detail with an append-only
  status timeline (`OrderStatusHistory`, never a mutable status column alone)
- Auth: register/login, JWT access token in memory, rotating httpOnly refresh cookie,
  silent refresh on 401, guest cart merged into the account on login

**Admin** (staff/admin role)

- Product CRUD (draft/publish, variants, images, per-variant stock)
- Category CRUD (self-referencing tree with parent/child)
- Manual stock adjustments per variant (signed deltas with reasons)
- Order list + detail with status updates restricted to valid transitions
  (`pending → confirmed → packed → shipped → delivered`, cancellations where allowed)

**Concurrency:** checkout locks inventory rows with `SELECT … FOR UPDATE` and creates the
order in the *same* transaction — stock is never checked and the order created as
separate steps. Covered by a race test (two concurrent checkouts → exactly one `201`,
one `409`).

**Not in this phase (by design):** reviews, wishlist, coupons, discounts, banners,
notifications.

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
.\.venv\Scripts\python -m pytest -q          # 27 tests (auth, catalog, cart merge, checkout race, orders, admin)
.\.venv\Scripts\python -m ruff check app tests
.\.venv\Scripts\python -m app.seed           # seed demo data (no-op if already seeded)

# frontend
cd frontend
npm run dev                                  # Vite dev server
npm run build                                # tsc --noEmit + vite build
npx tsc --noEmit                             # typecheck only
node scripts/smoke.mjs                       # full E2E smoke (needs dev servers running)
node scripts/responsive.mjs                  # mobile/tablet screenshots
```

`scripts/smoke.mjs` drives Chrome (puppeteer-core) through the entire slice on both sides:
home → browse → sort → product → add to cart → checkout → login → place order → order
history → admin login → product list/edit → stock → orders → status update → customer
timeline. It screenshots every step (temp dir path printed at the end) and exits non-zero
on any failure or console/API error.

## API conventions

- Base path `/api`; the Vite dev server proxies `/api` → `http://localhost:8000`
  (same-origin so the refresh cookie works; override with `VITE_API_BASE_URL`).
- Errors are always `{"error": {"code", "message", "details"}}` (HTTP status + envelope),
  with Pydantic field errors in `details` for validation failures.
- List endpoints (`/products`, `/admin/products`, `/orders`, `/admin/orders`,
  `/admin/inventory`) take `page`, `page_size`, plus endpoint-specific `q` / `category` /
  `brand` / `in_stock` / `status` filters and a `sort` whitelist.
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
    orders/           checkout (FOR UPDATE), status history, payment registry, admin ops
  app/seed.py         demo catalogue + accounts
  tests/              pytest suite (uses onemart_test DB, REDIS_DISABLED)
frontend/
  src/lib/            typed API client, query keys, formatting (INR), types
  src/hooks/queries/  TanStack Query hooks (catalog, cart, checkout, orders, admin)
  src/stores/auth.ts  Zustand auth store
  src/components/     ui primitives, layout shells, catalog/orders components
  src/pages/          customer pages + admin pages
  scripts/            E2E smoke + responsive screenshot tools
```

## Design system

Defined once in `frontend/src/index.css` (Tailwind v4 `@theme`), used everywhere:

- **Palette:** paper `#f5f4ee`, surface white, ink `#16211b`, forest `#1f3d2b`,
  leaf `#2e7350`, mist `#e8ede8`, line `#d9d5c9`, brick (error) `#a63a2b`,
  amber (warning) `#96681a`
- **Type:** Fraunces (display) + IBM Plex Sans (text) via Google Fonts; tabular numerals
  (`.num`) for prices; `.label` small-caps eyebrow style
- **Shape:** 2–3px radii, hairline borders, no gradients, no `rounded-2xl` cards
- **States:** skeletons (never spinners) for loading, designed empty/error states on
  every screen; fully responsive layout (mobile drawer nav, 2→3→4 column grids)

Currency is formatted as INR with `en-IN` locale throughout.

## Notes

- `JWT_SECRET` in `docker-compose.yml` is a development value — replace it anywhere real.
- Guest carts live behind an httpOnly `om_cart` cookie and are merged into the account on
  login/refresh (relationship-aware merge so delete-orphan cascades never drop items).
- Order statuses are append-only history rows; the list/detail views replay them into a
  timeline and the admin can only move an order to a valid next status.
