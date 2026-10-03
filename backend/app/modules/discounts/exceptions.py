from app.core.exceptions import ConflictError


class CouponError(ConflictError):
    """The coupon itself cannot be used right now: expired, deactivated, fully
    redeemed, or already used by this customer.

    Deliberately distinct from a plain ``ConflictError`` (a basket below the
    minimum): those mean *this cart* stopped qualifying and only clear the code
    from the cart, while this one means the discount the customer was shown is
    about to disappear — so checkout stops and says why instead of quietly
    charging the higher total.
    """

    status_code = 409
    code = "coupon_unavailable"
