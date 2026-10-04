from sqlalchemy.orm import Session

from app.modules.audit.models import AuditLog


def record(
    db: Session,
    *,
    actor_id: int | None,
    action: str,
    entity: str,
    entity_id: int | None = None,
    detail: dict | None = None,
) -> AuditLog:
    """Append an entry to the caller's transaction.

    No commit here on purpose: the row is written iff the action it describes
    is committed, and rolled back with it if the action fails.
    """
    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        entity=entity,
        entity_id=entity_id,
        detail=detail or {},
    )
    db.add(entry)
    db.flush()
    return entry
