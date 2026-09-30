import { Link } from "react-router-dom";

import { useCategories } from "@/hooks/queries/catalog";
import { isStaff, useAuth } from "@/stores/auth";

export function Footer() {
  const { data: categories } = useCategories();
  const { user } = useAuth();
  const top = (categories ?? []).slice(0, 6);

  return (
    <footer className="mt-16 bg-forest text-paper">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-4">
        <div className="md:col-span-1">
          <p className="font-display text-2xl font-semibold tracking-tight">OneMart</p>
          <p className="mt-3 text-sm leading-relaxed text-paper/70">
            Everything you need, in one place — groceries, home care and daily essentials,
            delivered with cash on delivery.
          </p>
        </div>
        <div>
          <p className="label text-paper/50">Shop</p>
          <ul className="mt-3 space-y-2 text-sm text-paper/85">
            <li>
              <Link to="/products" className="hover:text-paper underline-offset-4 hover:underline">
                All products
              </Link>
            </li>
            {top.map((cat) => (
              <li key={cat.id}>
                <Link
                  to={`/products?category=${cat.slug}`}
                  className="hover:text-paper underline-offset-4 hover:underline"
                >
                  {cat.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="label text-paper/50">Account</p>
          <ul className="mt-3 space-y-2 text-sm text-paper/85">
            <li>
              <Link to="/orders" className="hover:text-paper underline-offset-4 hover:underline">
                My orders
              </Link>
            </li>
            <li>
              <Link to="/cart" className="hover:text-paper underline-offset-4 hover:underline">
                Cart
              </Link>
            </li>
            <li>
              <Link to="/login" className="hover:text-paper underline-offset-4 hover:underline">
                Sign in
              </Link>
            </li>
            {user && isStaff(user) ? (
              <li>
                <Link
                  to="/admin/products"
                  className="hover:text-paper underline-offset-4 hover:underline"
                >
                  Admin console
                </Link>
              </li>
            ) : null}
          </ul>
        </div>
        <div>
          <p className="label text-paper/50">Good to know</p>
          <ul className="mt-3 space-y-2 text-sm text-paper/85">
            <li>Cash on delivery on every order</li>
            <li>Free delivery on orders over ₹999</li>
            <li>Delivery fee of ₹40 below that</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-paper/15">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[0.75rem] text-paper/55">
          <span>© {new Date().getFullYear()} OneMart</span>
          <span className="label text-[0.625rem]">Everything you need, in one place.</span>
        </div>
      </div>
    </footer>
  );
}
