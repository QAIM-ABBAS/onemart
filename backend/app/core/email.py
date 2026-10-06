import logging

logger = logging.getLogger("onemart.email")


class EmailProvider:
    """Interface every transport implements.

    Console today, SMTP/API later — callers only ever see this interface, so
    swapping the transport never touches the notification code.
    """

    def send(self, *, to: str, subject: str, body: str) -> None:
        raise NotImplementedError


class ConsoleEmailProvider(EmailProvider):
    """Logs instead of sending. SMTP-ready by construction."""

    def send(self, *, to: str, subject: str, body: str) -> None:
        logger.info("email to=%s subject=%r\n%s", to, subject, body)


_provider: EmailProvider = ConsoleEmailProvider()


def get_email_provider() -> EmailProvider:
    return _provider


def set_email_provider(provider: EmailProvider) -> None:
    """Test seam — and the future `set_email_provider(SMTP...)` switch."""
    global _provider
    _provider = provider
