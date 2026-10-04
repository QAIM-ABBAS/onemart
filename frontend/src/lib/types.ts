export type UserRole = "customer" | "staff" | "admin";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

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
  discount: number;
  coupon: CouponOut | null;
  delivery_fee: number;
  total: number;
  item_count: number;
}

export interface PaymentMethodInfo {
  code: string;
  name: string;
}

export interface CheckoutSummary {
  items: CartItemOut[];
  subtotal: number;
  discount: number;
  coupon: CouponOut | null;
  delivery_fee: number;
  total: number;
  item_count: number;
  payment_methods: PaymentMethodInfo[];
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
}

export interface StatusEventOut {
  id: number;
  status: OrderStatus;
  note?: string | null;
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
  created_at: string;
  placed_at: string;
  items: OrderItemOut[];
  history: StatusEventOut[];
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

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: unknown;
  };
}
