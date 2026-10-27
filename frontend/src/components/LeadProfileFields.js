import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
  EXPERIENCE_LABEL,
  EXPERIENCE_LEVELS,
  CAPITAL_RANGES,
  INCOME_BRACKETS,
  INCOME_LABEL,
  MARKETS,
  MARKET_LABEL,
  OCCUPATIONS,
  OCCUPATION_LABEL,
  TRADER_LABEL,
  TRADER_TYPES,
  INDIAN_STATES_AND_UTS,
} from "@/lib/leadProfile";

const Field = ({ label, children }) => (
  <div>
    <div className="overline mb-1.5">{label}</div>
    {children}
  </div>
);

const MarketChips = ({ value = [], onChange, testId }) => (
  <div className="flex flex-wrap gap-1.5" data-testid={testId}>
    {MARKETS.map((market) => {
      const on = value.includes(market);
      return (
        <button
          key={market}
          type="button"
          data-testid={`${testId}-${market}`}
          aria-pressed={on}
          onClick={() => onChange(on ? value.filter((m) => m !== market) : [...value, market])}
          className={`border px-2.5 py-1 text-xs transition-colors duration-150 ${
            on
              ? "border-brand bg-brand/15 text-brand"
              : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground"
          }`}
        >
          {MARKET_LABEL[market]}
        </button>
      );
    })}
  </div>
);

/** Job profile + trading questions, shared by every place a lead is captured or edited. */
export const LeadProfileFields = ({ profile, onChange, idPrefix = "profile" }) => {
  const [brokers, setBrokers] = useState([]);
  useEffect(() => {
    api.get("/payments/50-cr-club/brokers").then(({ data }) => setBrokers(data.brokers || [])).catch(() => {});
  }, []);
  const set = (patch) => onChange({ ...profile, ...patch });
  const isTrader = profile.trader_type === "trader";
  const isClubMember = (profile.tags || []).includes("50-cr-club");
  const brokerOptions = [...new Set([...brokers, ...(profile.broker_name ? [profile.broker_name] : [])])];

  return (
    <div className="grid gap-4" data-testid={`${idPrefix}-fields`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="State / Union territory">
          <Select value={profile.state || ""} onValueChange={(v) => set({ state: v })}>
            <SelectTrigger data-testid={`${idPrefix}-state`} className="rounded-none border-border/70 bg-background">
              <SelectValue placeholder="Select state or UT" />
            </SelectTrigger>
            <SelectContent>
              {INDIAN_STATES_AND_UTS.map(([value, label]) => (
                <SelectItem key={value} value={value} data-testid={`${idPrefix}-state-${value}`}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Job profile">
          <Select value={profile.occupation || ""} onValueChange={(v) => set({ occupation: v })}>
            <SelectTrigger data-testid={`${idPrefix}-occupation`} className="rounded-none border-border/70 bg-background">
              <SelectValue placeholder="Select occupation" />
            </SelectTrigger>
            <SelectContent>
              {OCCUPATIONS.map((o) => (
                <SelectItem key={o} value={o} data-testid={`${idPrefix}-occupation-${o}`}>
                  {OCCUPATION_LABEL[o]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Yearly income">
          <Select value={profile.annual_income || ""} onValueChange={(v) => set({ annual_income: v })}>
            <SelectTrigger data-testid={`${idPrefix}-income`} className="rounded-none border-border/70 bg-background">
              <SelectValue placeholder="Select income range" />
            </SelectTrigger>
            <SelectContent>
              {INCOME_BRACKETS.map((i) => (
                <SelectItem key={i} value={i} data-testid={`${idPrefix}-income-${i}`}>
                  {INCOME_LABEL[i]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Trader or non trader">
        <Select value={profile.trader_type || ""} onValueChange={(v) => set({ trader_type: v })}>
          <SelectTrigger data-testid={`${idPrefix}-trader-type`} className="rounded-none border-border/70 bg-background">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {TRADER_TYPES.map((t) => (
              <SelectItem key={t} value={t} data-testid={`${idPrefix}-trader-type-${t}`}>
                {TRADER_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {isTrader && (
        <div className="grid gap-4 border-l-2 border-brand/40 pl-4" data-testid={`${idPrefix}-trader-block`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Trading experience">
              <Select value={profile.trading_experience || ""} onValueChange={(v) => set({ trading_experience: v })}>
                <SelectTrigger data-testid={`${idPrefix}-experience`} className="rounded-none border-border/70 bg-background">
                  <SelectValue placeholder="How long trading" />
                </SelectTrigger>
                <SelectContent>
                  {EXPERIENCE_LEVELS.map((e) => (
                    <SelectItem key={e} value={e} data-testid={`${idPrefix}-experience-${e}`}>
                      {EXPERIENCE_LABEL[e]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Trading capital range">
              <Select value={profile.trading_capital_range || ""} onValueChange={(v) => set({ trading_capital_range: v })}>
                <SelectTrigger data-testid={`${idPrefix}-capital`} className="rounded-none border-border/70 bg-background">
                  <SelectValue placeholder="Select capital range" />
                </SelectTrigger>
                <SelectContent>
                  {CAPITAL_RANGES.map(([key, label]) => (
                    <SelectItem key={key} value={key} data-testid={`${idPrefix}-capital-${key}`}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Markets they trade">
            <MarketChips
              value={profile.markets_traded}
              onChange={(markets_traded) => set({ markets_traded })}
              testId={`${idPrefix}-markets-traded`}
            />
          </Field>
        </div>
      )}

      <Field label="Markets they are interested in">
        <MarketChips
          value={profile.markets_interested}
          onChange={(markets_interested) => set({ markets_interested })}
          testId={`${idPrefix}-markets-interested`}
        />
      </Field>

      {isClubMember && <section className="grid gap-4 border-t border-border/60 pt-4" data-testid={`${idPrefix}-club-details`}>
        <div><div className="overline">50 Cr Club details</div><p className="mt-1 text-xs text-muted-foreground">Seller source, broker relationship, product usage, and follow-up plan</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Broker used">
            <Select value={profile.broker_name || "not_recorded"} onValueChange={(value) => set({ broker_name: value === "not_recorded" ? "" : value })}>
              <SelectTrigger data-testid={`${idPrefix}-broker-name`} className="rounded-none border-border/70 bg-background"><SelectValue placeholder="Select broker" /></SelectTrigger>
              <SelectContent><SelectItem value="not_recorded">Not recorded</SelectItem>{brokerOptions.length ? brokerOptions.map((broker) => <SelectItem key={broker} value={broker}>{broker}</SelectItem>) : <SelectItem value="__none" disabled>No brokers configured</SelectItem>}</SelectContent>
            </Select>
          </Field>
          <Field label="Broker unique ID"><Input value={profile.broker_unique_id || ""} onChange={(event) => set({ broker_unique_id: event.target.value })} placeholder="Client or account ID" maxLength={160} data-testid={`${idPrefix}-broker-unique-id`} /></Field>
          <Field label="New broker name"><Input value={profile.new_broker_name || ""} onChange={(event) => set({ new_broker_name: event.target.value })} placeholder="New broker" maxLength={120} data-testid={`${idPrefix}-new-broker-name`} /></Field>
          <Field label="Current broker name"><Input value={profile.current_broker_name || ""} onChange={(event) => set({ current_broker_name: event.target.value })} placeholder="Current broker" maxLength={120} data-testid={`${idPrefix}-current-broker-name`} /></Field>
          <Field label="Broker account opening">
            <Select value={profile.broker_account_status || "not_recorded"} onValueChange={(value) => set({ broker_account_status: value === "not_recorded" ? "" : value })}>
              <SelectTrigger data-testid={`${idPrefix}-broker-account-status`} className="rounded-none border-border/70 bg-background"><SelectValue placeholder="Select status" /></SelectTrigger>
              <SelectContent><SelectItem value="not_recorded">Not recorded</SelectItem><SelectItem value="opened">Account opened</SelectItem><SelectItem value="in_progress">In progress</SelectItem><SelectItem value="not_opened">Not opened</SelectItem><SelectItem value="not_required">Not required</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Deposit made?">
            <Select value={profile.deposit_made == null ? "not_recorded" : profile.deposit_made ? "yes" : "no"} onValueChange={(value) => set({ deposit_made: value === "not_recorded" ? null : value === "yes" })}>
              <SelectTrigger data-testid={`${idPrefix}-deposit-made`} className="rounded-none border-border/70 bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="not_recorded">Not recorded</SelectItem><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Deposit amount (INR)"><Input type="number" min="0" step="0.01" value={profile.deposit_amount ?? ""} onChange={(event) => set({ deposit_amount: event.target.value === "" ? null : Number(event.target.value) })} placeholder="Amount" data-testid={`${idPrefix}-deposit-amount`} /></Field>
          <Field label="How do they trade?">
            <Select value={profile.trading_mode || "not_recorded"} onValueChange={(value) => set({ trading_mode: value === "not_recorded" ? "" : value })}>
              <SelectTrigger data-testid={`${idPrefix}-trading-mode`} className="rounded-none border-border/70 bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="not_recorded">Not recorded</SelectItem><SelectItem value="self">Self</SelectItem><SelectItem value="group">Group</SelectItem><SelectItem value="both">Both</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Expected group profit (INR)"><Input type="number" min="0" step="0.01" value={profile.expected_group_profit ?? ""} onChange={(event) => set({ expected_group_profit: event.target.value })} placeholder="Amount" data-testid={`${idPrefix}-expected-group-profit`} /></Field>
          <Field label="Still using product?">
            <Select value={profile.product_in_use || "not_recorded"} onValueChange={(value) => set({ product_in_use: value === "not_recorded" ? "" : value })}>
              <SelectTrigger data-testid={`${idPrefix}-product-in-use`} className="rounded-none border-border/70 bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="not_recorded">Not checked</SelectItem><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Membership enabled?">
            <Select value={profile.membership_enabled || "not_recorded"} onValueChange={(value) => set({ membership_enabled: value === "not_recorded" ? "" : value })}>
              <SelectTrigger data-testid={`${idPrefix}-membership-enabled`} className="rounded-none border-border/70 bg-background"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="not_recorded">Not checked</SelectItem><SelectItem value="yes">Enabled</SelectItem><SelectItem value="no">Disabled</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Next Club follow-up"><Input type="datetime-local" value={profile.club_next_follow_up_at || ""} onChange={(event) => set({ club_next_follow_up_at: event.target.value })} data-testid={`${idPrefix}-club-next-follow-up`} /></Field>
        </div>
        <Field label="Routine follow-up notes"><Textarea value={profile.follow_up_routine || ""} onChange={(event) => set({ follow_up_routine: event.target.value })} rows={3} maxLength={1000} placeholder="Preferred cadence, time, and agreed next steps" data-testid={`${idPrefix}-follow-up-routine`} /></Field>
      </section>}
    </div>
  );
};

export default LeadProfileFields;
