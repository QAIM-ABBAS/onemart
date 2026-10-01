export interface BannerSlide {
  id: string;
  image: string;
  title: string;
  subtitle: string;
  cta_label: string;
  cta_url: string;
  tone: "paper" | "forest";
}

export interface PromoBanner {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  cta_label: string;
  cta_url: string;
  image: string;
}

export interface BrandOffer {
  id: string;
  label: string;
  title: string;
  href: string;
  image: string;
  tint: string;
}

export interface NavItem {
  label: string;
  href: string;
  children?: { label: string; href: string }[];
}

export interface DealSlot {
  sold: number;
}

const TINTS = [
  { bg: "E7EEE9", fg: "1F3D2B" },
  { bg: "F1E7D8", fg: "5A4326" },
  { bg: "E9EEF3", fg: "1F3450" },
  { bg: "F3E4E0", fg: "5A2622" },
  { bg: "EDE8F2", fg: "38265A" },
  { bg: "EAF0E5", fg: "2E4A1F" },
] as const;

export function placeholderImage(text: string, index = 0): string {
  const tint = TINTS[index % TINTS.length];
  const params = new URLSearchParams({
    text: text.slice(0, 40),
    bg: tint.bg,
    fg: tint.fg,
  });
  return `/api/img/placeholder.svg?${params.toString()}`;
}

export function tintAt(index: number): string {
  return `#${TINTS[index % TINTS.length].bg}`;
}

export const HERO_BANNERS: BannerSlide[] = [
  {
    id: "fresh-week",
    image: placeholderImage("Fresh Produce", 0),
    title: "Fresh picks for the week",
    subtitle: "Fruit, vegetables and daily essentials — priced for the everyday shop.",
    cta_label: "Shop now",
    cta_url: "/products?category=fresh-produce",
    tone: "paper",
  },
  {
    id: "dairy-breakfast",
    image: placeholderImage("Dairy Bakery", 1),
    title: "Breakfast, sorted in one basket",
    subtitle: "Milk, eggs, bread and butter from the brands you already buy.",
    cta_label: "Shop now",
    cta_url: "/products?category=dairy-bakery",
    tone: "forest",
  },
  {
    id: "pantry-stockup",
    image: placeholderImage("Stock Up", 3),
    title: "Stock up the pantry for less",
    subtitle: "Snacks, staples and household refills with cash on delivery.",
    cta_label: "Shop now",
    cta_url: "/products?sort=bestselling",
    tone: "paper",
  },
];

export const PROMO_BANNER: PromoBanner = {
  id: "promo-featured",
  eyebrow: "This week only",
  title: "20% off featured picks",
  subtitle: "A hand-picked shelf of everyday favourites, discounted while stocks last.",
  cta_label: "Shop the offer",
  cta_url: "/products?featured=1",
  image: placeholderImage("Featured Offer", 4),
};

export const BRAND_OFFERS: BrandOffer[] = [
  {
    id: "offer-1",
    label: "Fresh today",
    title: "Fruit and vegetables, picked this morning",
    href: "/products?category=fresh-produce",
    image: placeholderImage("Fresh Produce", 5),
    tint: tintAt(5),
  },
  {
    id: "offer-2",
    label: "Bakery",
    title: "Bread and bakes for the whole family",
    href: "/products?category=bread-bakery",
    image: placeholderImage("Bread Bakery", 1),
    tint: tintAt(1),
  },
  {
    id: "offer-3",
    label: "Beverages",
    title: "Juices, tea and coffee from ₹99",
    href: "/products?category=beverages",
    image: placeholderImage("Juice Coffee", 2),
    tint: tintAt(2),
  },
  {
    id: "offer-4",
    label: "Stock up",
    title: "Snacks and sweets, buy more save more",
    href: "/products?category=snacks-sweets",
    image: placeholderImage("Snacks Sweets", 3),
    tint: tintAt(3),
  },
];

export const STATIC_NAV: NavItem[] = [
  { label: "All products", href: "/products" },
  { label: "Best sellers", href: "/products?sort=bestselling" },
  { label: "New arrivals", href: "/products?sort=newest" },
  { label: "Featured", href: "/products?featured=1" },
];

export const DEAL_SLOTS: DealSlot[] = [
  { sold: 25 },
  { sold: 44 },
  { sold: 18 },
  { sold: 61 },
  { sold: 33 },
];

const DEAL_DURATION_MS = (8 * 60 * 60 + 25 * 60 + 37) * 1000;

export const DEAL_ENDS_AT = new Date(Date.now() + DEAL_DURATION_MS).toISOString();

export const SHELF_TAB_LIMIT = 7;

export const FOOTER_LINKS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Customer service",
    links: [
      { label: "Track an order", href: "/orders" },
      { label: "Delivery & fees", href: "/cart" },
      { label: "Sign in", href: "/login" },
      { label: "Create an account", href: "/register" },
    ],
  },
  {
    title: "Good to know",
    links: [
      { label: "Cash on delivery", href: "/cart" },
      { label: "Free delivery over ₹999", href: "/cart" },
      { label: "Live order timeline", href: "/orders" },
    ],
  },
];
