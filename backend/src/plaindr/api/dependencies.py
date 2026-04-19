"""Shared FastAPI dependencies — singleton clients per app lifecycle."""

from functools import lru_cache

from plaindr.clients.policy_store import PolicyStore
from plaindr.clients.storage import SupabaseStorageClient
from plaindr.config import Settings


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_storage_client() -> SupabaseStorageClient:
    return SupabaseStorageClient(get_settings())


@lru_cache
def get_policy_store() -> PolicyStore:
    store = PolicyStore(get_storage_client(), get_settings())
    store.load()
    return store
