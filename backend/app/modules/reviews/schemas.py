from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.core.pagination import Page


class RatingBucket(BaseModel):
    rating: int
    count: int


class RatingSummary(BaseModel):
    average: float = 0.0
    count: int = 0
    distribution: list[RatingBucket] = Field(default_factory=list)


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    title: str = Field(min_length=3, max_length=120)
    body: str = Field(min_length=10, max_length=4000)

    @field_validator("title", "body")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Cannot be blank")
        return v


class ReviewOut(BaseModel):
    id: int
    product_id: int
    product_name: str
    product_slug: str
    user_id: int
    author: str
    rating: int
    title: str
    body: str
    # Server-derived at write time; never accepted from the client.
    verified_purchase: bool
    # Moderation state (customers only ever see visible reviews).
    is_visible: bool
    helpful_count: int
    viewer_has_voted: bool = False
    # Server decides who may edit/delete — the UI never guesses ownership.
    can_edit: bool = False
    created_at: datetime
    updated_at: datetime


class ReviewPage(Page[ReviewOut]):
    summary: RatingSummary


class ReviewModerateIn(BaseModel):
    is_visible: bool


class HelpfulOut(BaseModel):
    helpful_count: int
    viewer_has_voted: bool
