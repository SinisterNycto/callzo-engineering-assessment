from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

EventType = Literal["call.started", "call.ended", "call.failed"]

SEVEN_DAYS_SECONDS = 7 * 24 * 3600
TEN_MILLION_DOLLARS_IN_CENTS = 1_000_000_000


class CallEvent(BaseModel):
    """A webhook payload, validated strictly.

    strict=True means "12" is not an int and true is not an int, which is what
    we want for anything that ends up in a bill. Unknown extra fields are
    ignored so the provider can add fields without breaking us.
    Timestamps must carry a UTC offset; a naive timestamp is ambiguous about
    which billing month it belongs to, so it is rejected.
    """

    model_config = ConfigDict(strict=True, extra="ignore", frozen=True)

    event_id: str = Field(pattern=r"^evt_[A-Za-z0-9_-]{1,64}$")
    event_type: EventType
    account_id: str = Field(pattern=r"^acct_[A-Za-z0-9_-]{1,64}$")
    call_id: str = Field(pattern=r"^call_[A-Za-z0-9_-]{1,64}$")
    timestamp: AwareDatetime
    duration_seconds: int = Field(ge=0, le=SEVEN_DAYS_SECONDS)
    cost_cents: int = Field(ge=0, le=TEN_MILLION_DOLLARS_IN_CENTS)
    destination_country: str = Field(min_length=2, max_length=8)
