import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";

import { AdminShell } from "@/components/layout/AdminShell";
import { RequireAuth, Shell } from "@/components/layout/Shell";

import { CartPage } from "@/pages/Cart";
import { CheckoutPage } from "@/pages/Checkout";
import { HomePage } from "@/pages/Home";
import { LoginPage, RegisterPage } from "@/pages/Auth";
import { NotFoundPage } from "@/pages/NotFound";
import { OrderDetailPage, OrdersPage } from "@/pages/Orders";
import { ProductPage } from "@/pages/Product";
import { BrowsePage } from "@/pages/Browse";
import { AdminCategoriesPage } from "@/pages/admin/Categories";
import { AdminOrdersPage } from "@/pages/admin/Orders";
import { AdminOrderDetailPage } from "@/pages/admin/OrderDetail";
import { AdminProductFormPage } from "@/pages/admin/ProductForm";
import { AdminProductsPage } from "@/pages/admin/Products";
import { AdminReviewsPage } from "@/pages/admin/Reviews";
import { AdminStockPage } from "@/pages/admin/Stock";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route
          path="/"
          element={
            <Shell>
              <HomePage />
            </Shell>
          }
        />
        <Route
          path="/products"
          element={
            <Shell>
              <BrowsePage />
            </Shell>
          }
        />
        <Route
          path="/p/:slug"
          element={
            <Shell>
              <ProductPage />
            </Shell>
          }
        />
        <Route
          path="/cart"
          element={
            <Shell>
              <CartPage />
            </Shell>
          }
        />
        <Route
          path="/checkout"
          element={
            <Shell>
              <RequireAuth>
                <CheckoutPage />
              </RequireAuth>
            </Shell>
          }
        />
        <Route
          path="/orders"
          element={
            <Shell>
              <RequireAuth>
                <OrdersPage />
              </RequireAuth>
            </Shell>
          }
        />
        <Route
          path="/orders/:orderId"
          element={
            <Shell>
              <RequireAuth>
                <OrderDetailPage />
              </RequireAuth>
            </Shell>
          }
        />
        <Route
          path="/login"
          element={
            <Shell>
              <LoginPage />
            </Shell>
          }
        />
        <Route
          path="/register"
          element={
            <Shell>
              <RegisterPage />
            </Shell>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth staffOnly>
              <AdminShell>
                <AdminProductsPage />
              </AdminShell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/products"
          element={
            <RequireAuth staffOnly>
              <AdminShell>
                <AdminProductsPage />
              </AdminShell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/products/new"
          element={
            <RequireAuth staffOnly>
              <AdminShell>
                <AdminProductFormPage />
              </AdminShell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/products/:productId/edit"
          element={
            <RequireAuth staffOnly>
              <AdminShell>
                <AdminProductFormPage />
              </AdminShell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/categories"
          element={
            <RequireAuth staffOnly>
              <AdminShell>
                <AdminCategoriesPage />
              </AdminShell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/reviews"
          element={
            <RequireAuth staffOnly>
              <AdminShell>
                <AdminReviewsPage />
              </AdminShell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/stock"
          element={
            <RequireAuth staffOnly>
              <AdminShell>
                <AdminStockPage />
              </AdminShell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/orders"
          element={
            <RequireAuth staffOnly>
              <AdminShell>
                <AdminOrdersPage />
              </AdminShell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/orders/:orderId"
          element={
            <RequireAuth staffOnly>
              <AdminShell>
                <AdminOrderDetailPage />
              </AdminShell>
            </RequireAuth>
          }
        />
        <Route
          path="*"
          element={
            <Shell>
              <NotFoundPage />
            </Shell>
          }
        />
      </Routes>
    </>
  );
}
