from datetime import datetime, timezone
from typing import Annotated, Any, List, Literal, Optional
from zoneinfo import ZoneInfo

TEAM_TZ = ZoneInfo("Asia/Kolkata")

from bson import ObjectId
from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, EmailStr, Field


def _to_str_id(v: Any) -> Any:
    if isinstance(v, ObjectId):
        return str(v)
    return v


PyObjectId = Annotated[str, BeforeValidator(_to_str_id)]

ROLES = ("admin", "subadmin", "team_leader", "telecaller")
LEAD_STATUSES = (
    "new_lead",
    "assigned",
    "contacted",
    "not_connected",
    "not_picked_up",
    "follow_up",
    "interested",
    "not_interested",
    "converted",
    "lost",
)
LEAD_SOURCES = ("manual", "csv", "website_form", "facebook_ads", "google_ads", "whatsapp", "payment_webhook", "other")

OCCUPATIONS = ("businessman", "job", "self_employed", "student", "retired", "homemaker", "other")
INCOME_BRACKETS = ("0", "below_3l", "3l_5l", "5l_10l", "10l_25l", "25l_50l", "above_50l", "above_1cr")
CAPITAL_RANGES = ("0", "below_1l", "1l_5l", "5l_10l", "10l_25l", "25l_50l", "50l_1cr", "1cr_plus")
TRADER_TYPES = ("trader", "non_trader")
TRADING_EXPERIENCE = ("less_1y", "1_3y", "3_5y", "above_5y")
MARKETS = ("equity", "futures_options", "commodity", "currency", "crypto", "mutual_funds", "ipo")


def ist_aware(value: Optional[datetime]) -> Optional[datetime]:
    """A time typed by the team is India time. Naive input is read as IST, then stored as UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=TEAM_TZ)
    return value.astimezone(timezone.utc)


ISTDateTime = Annotated[Optional[datetime], AfterValidator(ist_aware)]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    def to_mongo(self) -> dict:
        doc = self.model_dump(by_alias=True, exclude_none=False)
        doc.pop("_id", None)
        return doc

    @classmethod
    def from_mongo(cls, doc: Optional[dict]):
        if not doc:
            return None
        return cls.model_validate(doc)


class User(BaseDocument):
    name: str
    email: str
    role: str
    password_hash: Optional[str] = None
    team_id: Optional[PyObjectId] = None
    agent_number: Optional[str] = None
    agent_extension: Optional[str] = None
    call_mode: str = "phone"  # "desktop" = Smartflo softphone, "phone" = ring the mobile first
    daily_call_target: int = 0
    daily_conversion_target: int = 0
    is_50_cr_club_rm: bool = False
    active: bool = True
    created_at: datetime = Field(default_factory=utcnow)


class PublicUser(BaseDocument):
    name: str
    email: str
    role: str
    team_id: Optional[PyObjectId] = None
    agent_number: Optional[str] = None
    agent_extension: Optional[str] = None
    call_mode: str = "phone"
    daily_call_target: int = 0
    daily_conversion_target: int = 0
    is_50_cr_club_rm: bool = False
    active: bool = True
    created_at: Optional[datetime] = None


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    role: str
    team_id: Optional[str] = None
    agent_number: Optional[str] = None
    agent_extension: Optional[str] = None
    call_mode: Optional[str] = None
    daily_call_target: Optional[int] = None
    daily_conversion_target: Optional[int] = None
    is_50_cr_club_rm: bool = False


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[str] = None
    team_id: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=6)
    agent_number: Optional[str] = None
    agent_extension: Optional[str] = None
    call_mode: Optional[str] = None
    daily_call_target: Optional[int] = None
    daily_conversion_target: Optional[int] = None
    is_50_cr_club_rm: Optional[bool] = None


class CallPreferences(BaseModel):
    call_mode: Optional[str] = None
    agent_extension: Optional[str] = None
    agent_number: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class Team(BaseDocument):
    name: str
    leader_id: Optional[PyObjectId] = None
    created_at: datetime = Field(default_factory=utcnow)


class TeamCreate(BaseModel):
    name: str
    leader_id: Optional[str] = None
    member_ids: List[str] = Field(default_factory=list)


class Course(BaseDocument):
    name: str
    active: bool = True
    created_at: datetime = Field(default_factory=utcnow)


class CourseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class CourseUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    active: Optional[bool] = None


class LeadSourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class Note(BaseModel):
    text: str
    author_id: Optional[str] = None
    author_name: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class LeadProfile(BaseModel):
    """Shared profile questions captured by telecallers."""
    occupation: Optional[str] = None
    annual_income: Optional[str] = None
    trader_type: Optional[str] = None
    trading_experience: Optional[str] = None
    trading_capital: Optional[float] = None
    trading_capital_range: Optional[str] = None
    markets_traded: Optional[List[str]] = None
    markets_interested: Optional[List[str]] = None
    state: Optional[str] = None
    broker_name: Optional[str] = None
    broker_unique_id: Optional[str] = None
    broker_account_status: Optional[str] = None
    new_broker_name: Optional[str] = None
    current_broker_name: Optional[str] = None
    club_seller_type: Optional[Literal["direct", "seller"]] = None
    club_seller_name: Optional[str] = None
    deposit_made: Optional[bool] = None
    deposit_amount: Optional[float] = Field(default=None, ge=0)
    trading_mode: Optional[Literal["self", "group", "both"]] = None
    expected_group_profit: Optional[float] = Field(default=None, ge=0)
    product_in_use: Optional[bool] = None
    membership_enabled: Optional[bool] = None
    follow_up_routine: Optional[str] = None
    club_next_follow_up_at: ISTDateTime = None


class Lead(BaseDocument):
    name: str
    phone: str
    email: Optional[str] = None
    company: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    course_id: Optional[PyObjectId] = None
    course_name: Optional[str] = None
    source: str = "manual"
    status: str = "new_lead"
    occupation: Optional[str] = None
    annual_income: Optional[str] = None
    trader_type: Optional[str] = None
    trading_experience: Optional[str] = None
    trading_capital: Optional[float] = None
    trading_capital_range: Optional[str] = None
    markets_traded: List[str] = Field(default_factory=list)
    markets_interested: List[str] = Field(default_factory=list)
    broker_name: Optional[str] = None
    broker_unique_id: Optional[str] = None
    broker_account_status: Optional[str] = None
    new_broker_name: Optional[str] = None
    current_broker_name: Optional[str] = None
    club_seller_type: Optional[Literal["direct", "seller"]] = None
    club_seller_name: Optional[str] = None
    deposit_made: Optional[bool] = None
    deposit_amount: Optional[float] = Field(default=None, ge=0)
    trading_mode: Optional[Literal["self", "group", "both"]] = None
    expected_group_profit: Optional[float] = None
    product_in_use: Optional[bool] = None
    membership_enabled: Optional[bool] = None
    follow_up_routine: Optional[str] = None
    club_next_follow_up_at: Optional[datetime] = None
    club_joined_at: Optional[str] = None
    club_expires_at: Optional[str] = None
    conversion_status: str = "none"  # none, pending, approved, rejected
    ticket_size: Optional[float] = None
    conversion_requested_at: Optional[datetime] = None
    conversion_approved_at: Optional[datetime] = None
    conversion_approved_by: Optional[PyObjectId] = None
    conversion_source: Optional[str] = None
    conversion_auto_approved: bool = False
    conversion_approval_reason: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    notes: List[Note] = Field(default_factory=list)
    assigned_to: Optional[PyObjectId] = None
    assigned_to_name: Optional[str] = None
    team_id: Optional[PyObjectId] = None
    assigned_at: Optional[datetime] = None
    last_action_at: Optional[datetime] = None
    next_follow_up_at: Optional[datetime] = None
    escalated: bool = False
    reassign_count: int = 0
    created_by: Optional[PyObjectId] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class LeadCreate(LeadProfile):
    name: str
    phone: str
    email: Optional[str] = None
    company: Optional[str] = None
    city: Optional[str] = None
    course_id: Optional[str] = None
    source: str = "manual"
    status: str = "new_lead"
    tags: List[str] = Field(default_factory=list)


class PaymentClubLeadCreate(LeadCreate):
    team_id: str
    assignee_id: str


class PaymentClubBulkLeadCreate(BaseModel):
    event_ids: List[str] = Field(min_length=1, max_length=200)
    team_id: str
    assignee_id: str


class PaymentClubPurchaseAssign(BaseModel):
    event_ids: List[str] = Field(min_length=1, max_length=5000)
    team_id: str
    assignee_id: str


class ClubBrokerListUpdate(BaseModel):
    brokers: List[str] = Field(default_factory=list, max_length=100)


class ClubPurchaseStatusUpdate(BaseModel):
    status: Literal["unworked", "contacted", "follow_up", "enrolled", "not_interested", "lost"]


class ClubMemberProfileUpdate(BaseModel):
    broker_name: Optional[str] = Field(default=None, max_length=120)
    broker_unique_id: Optional[str] = Field(default=None, max_length=160)
    broker_account_status: Optional[str] = Field(default=None, max_length=40)
    new_broker_name: Optional[str] = Field(default=None, max_length=120)
    current_broker_name: Optional[str] = Field(default=None, max_length=120)
    club_seller_type: Optional[Literal["direct", "seller"]] = None
    club_seller_name: Optional[str] = Field(default=None, max_length=120)
    deposit_made: Optional[bool] = None
    deposit_amount: Optional[float] = Field(default=None, ge=0)
    trading_mode: Optional[Literal["self", "group", "both"]] = None
    expected_group_profit: Optional[float] = Field(default=None, ge=0)
    product_in_use: Optional[bool] = None
    membership_enabled: Optional[bool] = None
    follow_up_routine: Optional[str] = Field(default=None, max_length=1000)
    next_follow_up_at: Optional[datetime] = None


class LeadUpdate(LeadProfile):
    name: Optional[str] = None
    email: Optional[str] = None
    company: Optional[str] = None
    city: Optional[str] = None
    course_id: Optional[str] = None
    status: Optional[str] = None
    next_follow_up_at: ISTDateTime = None
    tags: Optional[List[str]] = None


class ConversionApproval(BaseModel):
    ticket_size: Optional[float] = Field(default=None, gt=0)


class NoteCreate(BaseModel):
    text: str
    status: Optional[str] = None
    next_follow_up_at: ISTDateTime = None


class CallOutcomeUpdate(BaseModel):
    call_outcome: str
    status: Optional[str] = None
    next_follow_up_at: ISTDateTime = None


class ManualCallOutcomeUpdate(CallOutcomeUpdate):
    call_number: int = Field(ge=1, le=4)


class AssignRequest(BaseModel):
    lead_ids: List[str]
    assignee_id: str


class AutoAssignRequest(BaseModel):
    lead_ids: Optional[List[str]] = None
    limit: int = 50


class BulkLeadDeleteRequest(BaseModel):
    lead_ids: List[str]


class IntakeLead(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    company: Optional[str] = None
    city: Optional[str] = None
    source: str = "website_form"


class Activity(BaseDocument):
    lead_id: Optional[PyObjectId] = None
    lead_name: Optional[str] = None
    actor_id: Optional[PyObjectId] = None
    actor_name: str = "system"
    action: str
    detail: Optional[str] = None
    status_from: Optional[str] = None
    status_to: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class CrmActivity(BaseDocument):
    kind: str
    subject: str
    description: Optional[str] = None
    status: str = "open"
    priority: str = "normal"
    call_type: Optional[str] = None
    call_status: Optional[str] = None
    outcome: Optional[str] = None
    completed_at: Optional[datetime] = None
    due_at: Optional[datetime] = None
    contact_name: Optional[str] = None
    related_lead_id: Optional[PyObjectId] = None
    owner_id: Optional[PyObjectId] = None
    owner_name: Optional[str] = None
    created_by: Optional[PyObjectId] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class CrmActivityCreate(BaseModel):
    kind: str
    subject: str
    description: Optional[str] = None
    priority: str = "normal"
    call_type: Optional[str] = None
    call_status: Optional[str] = None
    outcome: Optional[str] = None
    due_at: Optional[datetime] = None
    contact_name: Optional[str] = None
    related_lead_id: Optional[str] = None


class CrmActivityUpdate(BaseModel):
    status: Optional[str] = None
    subject: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    call_type: Optional[str] = None
    call_status: Optional[str] = None
    outcome: Optional[str] = None
    completed_at: Optional[datetime] = None
    due_at: Optional[datetime] = None


class Document(BaseDocument):
    name: str
    stored_name: str
    content_type: str
    size: int
    owner_id: Optional[PyObjectId] = None
    owner_name: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)


class ChatMessage(BaseDocument):
    text: str
    sender_id: Optional[PyObjectId] = None
    sender_name: str
    sender_role: str
    team_id: Optional[PyObjectId] = None
    created_at: datetime = Field(default_factory=utcnow)


class ChatMessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=2000)