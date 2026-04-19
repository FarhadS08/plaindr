"""Company domain model — maps to the MongoDB 'users' (companies) collection."""

from uuid import UUID, uuid4

from pydantic import BaseModel, Field, HttpUrl


class CompanyDocument(BaseModel):
    """A company whose AI policies are tracked by the system."""

    id: UUID = Field(default_factory=uuid4)
    name: str
    category: str  # e.g. "coding", "health", "social_media"
    main_url: HttpUrl  # Company homepage, not a policy URL
