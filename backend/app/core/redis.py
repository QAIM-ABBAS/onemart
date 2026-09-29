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


def session_set(token_id: str, user_id: int, ttl_seconds: int) -> None:
    cache_set(f"refresh:{token_id}", str(user_id), ttl_seconds)


def session_get(token_id: str) -> int | None:
    value = cache_get(f"refresh:{token_id}")
    return int(value) if value is not None else None


def session_revoke(token_id: str) -> None:
    cache_delete(f"refresh:{token_id}")


def session_revoke_all(user_id: int) -> None:
    cache_delete_prefix("refresh:*")
