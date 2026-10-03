import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { isStaff, useAuth } from "@/stores/auth";

import { EmptyState, Skeleton, SkeletonText } from "@/components/ui/States";
import { Toaster } from "@/components/ui/Toaster";

import { Footer } from "./Footer";
import { Header } from "./Header";

/**
 * Page shell — the top of the box family tree (practice: build a layout
 * hierarchy first, then fix boxes against it):
 *
 *   shell                 column flex, min height = viewport
 *   ├─ header             sticky row stack (its own hierarchy, see Header)
 *   ├─ main               grows to fill whatever the header/footer leave
 *   │   └─ page           centred box, max width + inline padding
 *   │       └─ section    one row or one grid of columns per screen size
 *   └─ footer             column of rows: newsletter · link columns · legal
 *
 * Every page only ever fills `main`; nothing below it needs to know how tall
 * the header or footer is.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <Toaster />
    </div>
  );
}

export function FullPageBooting() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <Skeleton className="h-8 w-56" />
      <SkeletonText lines={4} className="mt-6 max-w-xl" />
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="aspect-[3/4]" />
        ))}
      </div>
    </div>
  );
}

export function RequireAuth({
  children,
  staffOnly = false,
}: {
  children: ReactNode;
  staffOnly?: boolean;
}) {
  const { user, booted } = useAuth();
  const location = useLocation();

  if (!booted) return <FullPageBooting />;

  if (!user) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (staffOnly && !isStaff(user)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="You do not have access to the admin console"
          body={`Your account (${user.email}) is a customer account. Admin access needs a staff or admin role.`}
        />
      </div>
    );
  }

  return <>{children}</>;
}
