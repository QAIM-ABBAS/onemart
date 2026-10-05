import { Link, useLocation } from "react-router-dom";

import { useWishlistPrompt } from "@/hooks/useWishlist";

import { Button } from "@/components/ui/Button";
import { HeartIcon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";

/**
 * Guest heart → sign-in prompt.
 *
 * One dialog for the whole storefront: any product card (or the product page)
 * can raise it. The tapped product is already parked in localStorage, so
 * signing in adds it without the guest having to find it again.
 */
export function WishlistLoginPrompt() {
  const { product, dismiss } = useWishlistPrompt();
  const location = useLocation();
  const next = `${location.pathname}${location.search}`;

  return (
    <Modal
      open={product !== null}
      onClose={dismiss}
      title="Sign in to save items"
      description={
        product
          ? `${product.name} will be waiting in your wishlist.`
          : "Your wishlist follows your account."
      }
      footer={
        <>
          <Button variant="ghost" onClick={dismiss}>
            Keep browsing
          </Button>
          <Link to={`/register?next=${encodeURIComponent(next)}`}>
            <Button variant="secondary">Create account</Button>
          </Link>
          <Link to={`/login?next=${encodeURIComponent(next)}`}>
            <Button>Sign in</Button>
          </Link>
        </>
      }
    >
      <div className="flex items-start gap-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
          <HeartIcon width={18} height={18} fill="currentColor" />
        </span>
        <p className="text-sm leading-relaxed text-ink-muted">
          Your wishlist is kept with your account, so it is there on your phone,
          your laptop, and after you come back. Sign in and we will add{" "}
          <span className="font-medium text-ink">{product?.name ?? "your item"}</span> for you.
        </p>
      </div>
    </Modal>
  );
}
