import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("account");
  const { product, dismiss } = useWishlistPrompt();
  const location = useLocation();
  const next = `${location.pathname}${location.search}`;

  return (
    <Modal
      open={product !== null}
      onClose={dismiss}
      title={t("wishlistPrompt.title")}
      description={
        product
          ? t("wishlistPrompt.saved", { name: product.name })
          : t("wishlistPrompt.fallback")
      }
      footer={
        <>
          <Button variant="ghost" onClick={dismiss}>
            {t("wishlistPrompt.browse")}
          </Button>
          <Link to={`/register?next=${encodeURIComponent(next)}`}>
            <Button variant="secondary">{t("wishlistPrompt.register")}</Button>
          </Link>
          <Link to={`/login?next=${encodeURIComponent(next)}`}>
            <Button>{t("wishlistPrompt.signin")}</Button>
          </Link>
        </>
      }
    >
      <div className="flex items-start gap-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
          <HeartIcon width={18} height={18} fill="currentColor" />
        </span>
        <p className="text-sm leading-relaxed text-ink-muted">
          {t("wishlistPrompt.body", { name: product?.name ?? t("wishlistPrompt.fallback") })}
        </p>
      </div>
    </Modal>
  );
}
