export type UserRole = "customer" | "staff" | "admin";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled";

export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "partially_refunded";

/** One attempt against a gateway (an order can have several). */
export type PaymentAttemptStatus =
  | "initiated"
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "partially_refunded";

export interface PaymentAttempt {
  id: number;
  order_id: number;
  provider: string;
  amount: number;
  currency: string;
  status: PaymentAttemptStatus;
  provider_ref?: string | null;
  refunded_amount: number;
  created_at: string;
  paid_at?: string | null;
}

export interface PaymentAdminOut extends PaymentAttempt {
  order_number: string;
}

export interface PaymentDetailOut extends PaymentAdminOut {
  order_status: string;
  raw_response: Record<string, unknown>;
  attempts: PaymentAttempt[];
}

export interface PaymentInitiate {
  payment_id: number;
  order_id: number;
  redirect_url: string;
  status: string;
  amount: number;
  currency: string;
  expires_at?: string | null;
}

export interface PaymentStatusOut {
  payment_id: number;
  order_id: number;
  order_number: string;
  status: string;
  amount: number;
  currency: string;
  order_status: string;
  payment_deadline?: string | null;
  already_processed: boolean;
}

export interface RefundIn {
  amount?: number | null;
  reason?: string | null;
  manual?: boolean;
}


export interface User {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type?: string;
  user: User;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface BrandOut {
  id: number;
  name: string;
  slug: string;
}

export interface CategoryNode {
  id: number;
  name: string;
  slug: string;
  parent_id?: number | null;
  image_url?: string | null;
  is_active?: boolean;
  product_count?: number;
  children?: CategoryNode[];
}

export interface ProductListItem {
  id: number;
  name: string;
  slug: string;
  brand?: string | null;
  category: string;
  category_slug: string;
  thumbnail?: string | null;
  price: number;
  compare_at_price?: number | null;
  in_stock: boolean;
  available: number;
  variant_count: number;
  is_featured?: boolean;
  created_at: string;
  description?: string;
  unit?: string | null;
  rating?: number;
  review_count?: number;
  features?: string[];
}

export interface VariantOut {
  id: number;
  name: string;
  sku: string;
  attributes: Record<string, string>;
  price: number;
  compare_at_price?: number | null;
  is_default: boolean;
  is_active?: boolean;
  available?: number;
}

export interface ImageOut {
  id: number;
  url: string;
  alt?: string | null;
}

export interface ProductDetail {
  id: number;
  name: string;
  slug: string;
  description: string;
  brand?: BrandOut | null;
  category: CategoryNode;
  images: ImageOut[];
  variants: VariantOut[];
  price: number;
  compare_at_price?: number | null;
  in_stock: boolean;
  available: number;
  is_featured: boolean;
  created_at: string;
  /** Denormalised from the reviews table, kept in sync server-side. */
  rating_avg: number;
  rating_count: number;
  rating_distribution: RatingBucket[];
}

export interface RatingBucket {
  rating: number;
  count: number;
}

export interface RatingSummary {
  average: number;
  count: number;
  /** Always 5..1, so the bars render even at zero. */
  distribution: RatingBucket[];
}

export interface ReviewOut {
  id: number;
  product_id: number;
  product_name: string;
  product_slug: string;
  user_id: number;
  author: string;
  rating: number;
  title: string;
  body: string;
  verified_purchase: boolean;
  is_visible: boolean;
  helpful_count: number;
  viewer_has_voted: boolean;
  can_edit: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReviewPage extends Page<ReviewOut> {
  summary: RatingSummary;
}

export interface ReviewIn {
  rating: number;
  title: string;
  body: string;
}

export interface HelpfulOut {
  helpful_count: number;
  viewer_has_voted: boolean;
}

export interface WishlistVariant {
  id: number;
  name: string;
  price: number;
  compare_at_price?: number | null;
  available: number;
  is_default: boolean;
}

export interface WishlistItem {
  id: number;
  added_at: string;
  product_id: number;
  name: string;
  slug: string;
  thumbnail?: string | null;
  /** Read live on every request — a saved item never shows a stale price. */
  price: number;
  compare_at_price?: number | null;
  discount_percent?: number | null;
  available: number;
  in_stock: boolean;
  rating_avg: number;
  rating_count: number;
  variants: WishlistVariant[];
}

/** Which of the cards on screen are saved — the hearts' query payload. */
export interface WishlistIds {
  ids: number[];
  count: number;
}

export interface WishlistToggle {
  product_id: number;
  saved: boolean;
  count: number;
}

export interface ProductFacets {
  brands?: BrandOut[];
  min_price?: number | null;
  max_price?: number | null;
  total?: number;
}

export interface HomeData {
  categories: CategoryNode[];
  featured: ProductListItem[];
  best_sellers: ProductListItem[];
  new_arrivals: ProductListItem[];
}

export interface CartItemOut {
  id: number;
  variant_id: number;
  product_id: number;
  product_name: string;
  product_slug: string;
  variant_name: string;
  sku: string;
  image_url?: string | null;
  unit_price: number;
  /** Live flash-deal unit price for this line; null when not on a deal */
  deal_price?: number | null;
  quantity: number;
  line_total: number;
  available: number;
  in_stock: boolean;
}

export interface CouponOut {
  code: string;
  kind: string;
  value: number;
  description?: string | null;
  /** What this coupon removes from the current cart */
  discount: number;
}

export interface CartOut {
  id: number;
  items: CartItemOut[];
  subtotal: number;
  /** Flash-deal cut (list price minus deal price), before any other layer */
  flash_discount: number;
  /** Automatic (no-code) discount rules applied before any coupon */
  auto_discount: number;
  discount: number;
  coupon: CouponOut | null;
  delivery_fee: number;
  total: number;
  /** How much more to spend for free delivery; 0 when already unlocked */
  free_delivery_gap: number;
  item_count: number;
}

export interface PaymentMethodInfo {
  code: string;
  name: string;
}

export interface CheckoutSummary {
  items: CartItemOut[];
  subtotal: number;
  /** Flash-deal cut, before automatic discounts and the coupon */
  flash_discount: number;
  auto_discount: number;
  discount: number;
  coupon: CouponOut | null;
  delivery_fee: number;
  total: number;
  item_count: number;
  payment_methods: PaymentMethodInfo[];
  /** How long an online order holds its stock while payment is pending. */
  payment_reservation_minutes: number;
  /** False = zones exist but none covers the address → checkout is blocked. */
  serviceable: boolean;
  /** False = no zones configured (bootstrap mode, legacy flat fee applies). */
  delivery_configured: boolean;
  delivery_method: string;
  delivery_zone: { id: number; name: string } | null;
}

export interface ZoneMatchOut {
  serviceable: boolean;
  configured: boolean;
  zone: {
    id: number;
    name: string;
    postal_codes: string[];
    cities: string[];
    base_fee: number;
    express_fee: number;
    free_delivery_threshold: number | null;
    is_active: boolean;
  } | null;
}

export type SlotState = "available" | "limited" | "full" | "closed";

export interface DeliverySlotOut {
  id: number;
  date: string;
  start: string;
  end: string;
  capacity: number;
  booked_count: number;
  state: SlotState;
}

// ---- Admin delivery (zones, templates, blocked dates, board) ----

export interface ZoneAdminOut {
  id: number;
  name: string;
  postal_codes: string[];
  cities: string[];
  base_fee: number;
  express_fee: number;
  free_delivery_threshold: number | null;
  is_active: boolean;
}

export interface ZoneWrite {
  name: string;
  postal_codes: string[];
  cities: string[];
  base_fee: number;
  express_fee: number;
  free_delivery_threshold?: number | null;
  is_active: boolean;
}

export interface ZoneTemplateOut {
  id: number;
  zone_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
  capacity: number;
}

export interface ZoneTemplateWrite {
  weekday: number;
  start_time: string;
  end_time: string;
  capacity: number;
}

export interface BlockedDateOut {
  id: number;
  zone_id: number;
  blocked_date: string;
  reason?: string | null;
}

export interface DeliveryBoardEntry {
  order_id: number;
  order_number: string;
  status: OrderStatus;
  recipient_name: string;
  phone: string;
  address: string;
  slot_id: number | null;
  slot_start?: string | null;
  slot_end?: string | null;
  method: string;
  total: number;
  payment_status: PaymentStatus;
}

export interface DeliveryBoardGroup {
  slot_id: number | null;
  start?: string | null;
  end?: string | null;
  orders: DeliveryBoardEntry[];
}

export interface DeliveryBoard {
  date: string;
  zone_id: number;
  unscheduled: DeliveryBoardEntry[];
  groups: DeliveryBoardGroup[];
}

export interface AddressIn {
  full_name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country?: string;
  is_default?: boolean;
}

export interface AddressOut extends AddressIn {
  id: number;
}

export interface CheckoutIn {
  payment_method?: string;
  address_id?: number;
  address?: AddressIn;
  save_address?: boolean;
  note?: string;
  /** standard | express | scheduled (scheduled also needs slot_id). */
  delivery_method?: string;
  slot_id?: number;
}

export interface StatusEventOut {
  id: number;
  status: OrderStatus;
  note?: string | null;
  created_at: string;
}

export type NotificationType =
  | "order_placed"
  | "order_status"
  | "order_cancelled"
  | "review_hidden"
  | "announcement";

export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  read_at: string | null;
  created_at: string;
}

export interface OrderItemOut {
  id: number;
  variant_id?: number | null;
  product_name: string;
  variant_name: string;
  sku: string;
  product_slug: string;
  image_url?: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface OrderListItem {
  id: number;
  order_number: string;
  status: OrderStatus;
  payment_method: string;
  payment_status: PaymentStatus;
  total: number;
  item_count: number;
  created_at: string;
}

export interface OrderDetail {
  id: number;
  order_number: string;
  status: OrderStatus;
  payment_method: string;
  payment_status: PaymentStatus;
  recipient_name: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  subtotal: number;
  discount_total: number;
  coupon_code?: string | null;
  delivery_fee: number;
  total: number;
  customer_note?: string | null;
  /** Online payments: when the stock hold lapses (null for COD). */
  payment_deadline?: string | null;
  /** Delivery method the customer chose (standard | express | scheduled). */
  delivery_method: string;
  /** The booked delivery window (null for standard/express). */
  delivery_slot?: {
    id: number;
    slot_date: string;
    start_time: string;
    end_time: string;
  } | null;
  created_at: string;
  placed_at: string;
  items: OrderItemOut[];
  history: StatusEventOut[];
  payments: PaymentAttempt[];
}

export interface ProductAdminOut extends ProductListItem {
  description: string;
  category_id: number;
  brand_id?: number | null;
  updated_at: string;
  is_active: boolean;
  variants?: VariantOut[];
  images?: ImageOut[];
}

export interface VariantIn {
  id?: number;
  sku: string;
  name?: string;
  attributes?: Record<string, string>;
  price: number;
  compare_at_price?: number | null;
  is_default?: boolean;
  is_active?: boolean;
  position?: number;
  initial_stock?: number | null;
}

export interface ImageIn {
  id?: number;
  url: string;
  alt?: string;
  position?: number;
}

export interface ProductWrite {
  name: string;
  category_id: number;
  brand_id?: number | null;
  description?: string;
  is_active?: boolean;
  is_featured?: boolean;
  variants: VariantIn[];
  images?: ImageIn[];
}

export interface CategoryWrite {
  name: string;
  parent_id?: number | null;
  position?: number;
  is_active?: boolean;
  image_url?: string;
}

export interface BrandWrite {
  name: string;
}

/** Status chip computed server-side from the window + the active flag. */
export type PromoStatus = "active" | "scheduled" | "expired" | "inactive";

export interface CouponAdminOut {
  id: number;
  code: string;
  description?: string | null;
  kind: "percent" | "fixed" | "free_delivery";
  value: number;
  min_subtotal: number;
  max_discount?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  usage_limit?: number | null;
  per_user_limit?: number | null;
  used_count: number;
  is_active: boolean;
  status: PromoStatus;
  created_at: string;
}

export interface CouponWrite {
  code?: string;
  description?: string | null;
  kind?: "percent" | "fixed" | "free_delivery";
  value?: number;
  min_subtotal?: number;
  max_discount?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  usage_limit?: number | null;
  per_user_limit?: number | null;
  is_active?: boolean;
}

export interface DiscountAdminOut {
  id: number;
  scope: "product" | "category";
  kind: "percent" | "fixed";
  value: number;
  product_id?: number | null;
  category_id?: number | null;
  product_name?: string | null;
  category_name?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active: boolean;
  status: PromoStatus;
  created_at: string;
}

export interface DiscountWrite {
  scope?: "product" | "category";
  kind?: "percent" | "fixed";
  value?: number;
  product_id?: number | null;
  category_id?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active?: boolean;
}

export interface InventoryRow {
  variant_id: number;
  sku: string;
  variant_name: string;
  product_id: number;
  product_name: string;
  price: number;
  quantity: number;
  reserved: number;
  available: number;
  low_stock_threshold: number;
  updated_at: string;
}

export interface StockAdjustment {
  variant_id: number;
  delta?: number;
  set_to?: number;
  reason?: string;
}

export interface StatusUpdateIn {
  status: OrderStatus;
  note?: string;
}

// ---- Reports (admin dashboard) ----

export type ReportRangeKind = "today" | "7d" | "30d" | "custom";

export interface ReportMetric {
  current: number;
  previous: number;
  /** null when the previous window was zero — the ratio is undefined */
  delta_pct: number | null;
}

export interface ReportRangeInfo {
  kind: ReportRangeKind;
  start: string;
  end: string;
  bucket: "hour" | "day";
  previous_start: string;
  previous_end: string;
}

export interface ReportSeriesPoint {
  bucket: string;
  revenue: number;
  orders: number;
}

export interface ReportStatusCount {
  status: OrderStatus;
  orders: number;
  revenue: number;
}

export interface ReportTopProduct {
  product_id: number | null;
  product_name: string;
  units: number;
  revenue: number;
  orders: number;
}

export interface ReportCategorySales {
  category_id: number | null;
  name: string;
  revenue: number;
  units: number;
}

export interface ReportLowStockRow {
  variant_id: number;
  sku: string;
  product_name: string;
  product_slug: string;
  variant_name: string;
  quantity: number;
  available: number;
  threshold: number;
}

export interface ReportRecentOrder {
  id: number;
  order_number: string;
  customer: string;
  total: number;
  status: OrderStatus;
  placed_at: string;
}

export interface ReportActivity {
  id: number;
  action: string;
  entity: string;
  entity_id: number | null;
  actor: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ReportOverview {
  range: ReportRangeInfo;
  kpis: {
    revenue: ReportMetric;
    orders: ReportMetric;
    new_customers: ReportMetric;
    avg_order_value: ReportMetric;
  };
  revenue_series: ReportSeriesPoint[];
  status_breakdown: ReportStatusCount[];
  top_products: ReportTopProduct[];
  category_sales: ReportCategorySales[];
  low_stock: ReportLowStockRow[];
  recent_orders: ReportRecentOrder[];
  recent_activity: ReportActivity[];
  generated_at: string;
}

/* ── Flash deals ─────────────────────────────────────────────────────────── */

/** Public strip payload: one live deal with its claimable items. */
export interface FlashDealItemOut {
  id: number;
  variant_id: number;
  product_id: number;
  product_name: string;
  product_slug: string;
  image_url?: string | null;
  variant_name: string;
  /** Decimal-serialized money (strings) — parse before arithmetic */
  list_price: string;
  /** Effective deal unit price, always present (price or percent resolved) */
  deal_price: string;
  percent_off: string;
  stock_limit: number;
  stock_sold: number;
  remaining: number;
  claimed_percent: string;
  per_user_limit: number | null;
  /** Signed-in only: how many more this customer may claim (null = no limit) */
  per_user_remaining?: number | null;
}

export interface ActiveFlashDeal {
  id: number;
  name: string;
  starts_at: string | null;
  /** Server end time — the countdown ticks locally against this */
  ends_at: string | null;
  items: FlashDealItemOut[];
}

export type FlashDealStatus = "live" | "scheduled" | "ended" | "inactive";

export interface FlashDealAdminOut {
  id: number;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  status: FlashDealStatus;
  item_count: number;
  stock_sold: number;
  stock_limit: number;
  created_at: string;
}

export interface FlashDealWrite {
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
}

export interface FlashDealItemAdminOut {
  id: number;
  deal_id: number;
  variant_id: number;
  product_name: string;
  product_slug: string;
  variant_name: string;
  sku: string;
  list_price: number;
  deal_price: number | null;
  deal_percent: number | null;
  effective_price: number;
  stock_limit: number;
  stock_sold: number;
  remaining: number;
  claimed_percent: number;
  per_user_limit: number | null;
}

export interface FlashDealItemWrite {
  variant_id: number;
  deal_price?: number | null;
  deal_percent?: number | null;
  deal_stock_limit: number;
  per_user_limit?: number | null;
}

export interface FlashVariantRow {
  variant_id: number;
  product_id: number;
  product_name: string;
  product_slug: string;
  variant_name: string;
  sku: string;
  price: number;
  image_url?: string | null;
  /** Name of the live deal already claiming this variant, or null */
  in_live_deal: string | null;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: unknown;
  };
}
