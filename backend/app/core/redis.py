import time
from typing import Any

import redis

from app.core.config import settings

_redis_client: redis.Redis | None = None
_memory: dict[str, tuple[float, Any]] = {}
_use_memory = False


def _client() -> redis.Redis | None:
    global _redis_client, _use_memory
    if settings.redis_disabled or _use_memory:
        return None
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(
            settings.redis_url, decode_responses=True, socket_connect_timeout=1, socket_timeout=1
        )
    try:
        _redis_client.ping()
        return _redis_client
    except redis.RedisError:
        _use_memory = True
        return None


def cache_get(key: str) -> Any:
    client = _client()
    if client is None:
        item = _memory.get(key)
        if item is None:
            return None
        expires_at, value = item
        if expires_at and expires_at < time.time():
            _memory.pop(key, None)
            return None
        return value
    return client.get(key)


def cache_set(key: str, value: str, ttl: int) -> None:
    client = _client()
    if client is None:
        _memory[key] = (time.time() + ttl, value)
        return
    client.set(key, value, ex=ttl)


def cache_delete(*keys: str) -> None:
    for key in keys:
        _memory.pop(key, None)
    client = _client()
    if client is not None and keys:
        client.delete(*keys)


def cache_delete_prefix(prefix: str) -> None:
    for key in [k for k in _memory if k.startswith(prefix)]:
        _memory.pop(key, None)
    client = _client()
    if client is None:
        return
    for key in client.scan_iter(match=f"{prefix}*"):
        client.delete(key)


def cache_set_nx(key: str, value: str, ttl: int) -> bool:
    """``SET key value NX`` — True only when the key was still free. This is
    the dedup primitive behind "count one impression per banner per client"
    without any database round trip."""
    client = _client()
    if client is None:
        item = _memory.get(key)
        if item is not None:
            expires_at, _ = item
            if not expires_at or expires_at > time.time():
                return False
        _memory[key] = (time.time() + ttl, value)
        return True
    return bool(client.set(key, value, ex=ttl, nx=True))


def cache_incr(key: str, ttl: int, amount: int = 1) -> int:
    """Fixed-window counter: increments and starts the window's TTL on the
    first hit of each window (rate limiting)."""
    client = _client()
    if client is None:
        now = time.time()
        item = _memory.get(key)
        if item is None or (item[0] and item[0] < now):
            _memory[key] = (now + ttl, amount)
            return amount
        value = int(item[1]) + amount
        _memory[key] = (item[0], value)
        return value
    value = int(client.incrby(key, amount))
    if value == amount:
        client.expire(key, ttl)
    return value


# --- Buffered analytics counters -----------------------------------------
# Kept separate from the cache helpers on purpose: counters have no TTL and
# are never invalidated — they accumulate until a Celery flush drains them
# into Postgres (``bstats:*`` deliberately does not share the ``banners:``
# prefix the payload cache invalidates).


def counter_incr(key: str, amount: int = 1) -> None:
    client = _client()
    if client is None:
        item = _memory.get(key)
        _memory[key] = (0, (int(item[1]) if item else 0) + amount)
        return
    client.incrby(key, amount)


def counter_peek(key: str) -> int:
    client = _client()
    if client is None:
        item = _memory.get(key)
        return int(item[1]) if item else 0
    value = client.get(key)
    return int(value) if value is not None else 0


def counter_take_prefix(prefix: str) -> dict[str, int]:
    """Read-and-reset every counter under ``prefix`` (GETDEL, so an
    increment racing the flush lands in the *next* window rather than
    being lost)."""
    client = _client()
    out: dict[str, int] = {}
    if client is None:
        for key in [k for k in _memory if k.startswith(prefix)]:
            item = _memory.pop(key, None)
            if item is not None:
                out[key] = int(item[1])
        return out
    for key in client.scan_iter(match=f"{prefix}*"):
        value = client.getdel(key)
        if value is not None:
            out[key] = int(value)
    return out


def session_set(token_id: str, user_id: int, ttl_seconds: int) -> None:
    cache_set(f"refresh:{token_id}", str(user_id), ttl_seconds)


def session_get(token_id: str) -> int | None:
    value = cache_get(f"refresh:{token_id}")
    return int(value) if value is not None else None


def session_revoke(token_id: str) -> None:
    cache_delete(f"refresh:{token_id}")


def session_revoke_all(user_id: int) -> None:
    cache_delete_prefix("refresh:*")
