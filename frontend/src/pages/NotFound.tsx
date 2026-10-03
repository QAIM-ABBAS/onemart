import { EmptyState } from "@/components/ui/States";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20">
      <EmptyState
        title="Page not found"
        body="The page you were looking for does not exist or has moved."
        action={
          <Link
            to="/"
            className="inline-flex h-11 items-center rounded-md bg-brand-700 px-5 text-sm font-semibold text-surface shadow-button transition hover:bg-brand-800 hover:-translate-y-px"
          >
            Back to home
          </Link>
        }
      />
    </div>
  );
}
