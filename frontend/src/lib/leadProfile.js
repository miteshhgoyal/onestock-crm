export const OCCUPATION_LABEL = {
  businessman: "Businessman",
  job: "Job / Salaried",
  self_employed: "Self employed",
  student: "Student",
  retired: "Retired",
  homemaker: "Homemaker",
  other: "Other",
};

export const INCOME_LABEL = {
  "0": "₹0",
  below_3l: "Below ₹3L",
  "3l_5l": "₹3L – ₹5L",
  "5l_10l": "₹5L – ₹10L",
  "10l_25l": "₹10L – ₹25L",
  "25l_50l": "₹25L – ₹50L",
  above_50l: "Above ₹50L",
  above_1cr: "Above ₹1Cr",
};

export const TRADER_LABEL = {
  trader: "Trader",
  non_trader: "Non trader",
};

export const EXPERIENCE_LABEL = {
  less_1y: "Under 1 year",
  "1_3y": "1 – 3 years",
  "3_5y": "3 – 5 years",
  above_5y: "5+ years",
};

export const MARKET_LABEL = {
  equity: "Equity",
  futures_options: "Futures & Options",
  commodity: "Commodity",
  currency: "Currency",
  crypto: "Crypto",
  mutual_funds: "Mutual Funds",
  ipo: "IPO",
};

export const CAPITAL_RANGES = [
  ["0", "₹0", 0, 0],
  ["below_1l", "Below ₹1L", 0, 100000],
  ["1l_5l", "₹1L – ₹5L", 100000, 500000],
  ["5l_10l", "₹5L – ₹10L", 500000, 1000000],
  ["10l_25l", "₹10L – ₹25L", 1000000, 2500000],
  ["25l_50l", "₹25L – ₹50L", 2500000, 5000000],
  ["50l_1cr", "₹50L – ₹1Cr", 5000000, 10000000],
  ["1cr_plus", "₹1Cr+", 10000000, null],
];

const CAPITAL_RANGE_BY_KEY = Object.fromEntries(CAPITAL_RANGES.map((range) => [range[0], range]));

function capitalRangeFromValue(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  if (amount === 0) return "0";
  return CAPITAL_RANGES.find(([, , min, max]) => amount >= min && (max == null || amount < max))?.[0] || "";
}

export const OCCUPATIONS = Object.keys(OCCUPATION_LABEL);
export const INCOME_BRACKETS = Object.keys(INCOME_LABEL);
export const TRADER_TYPES = Object.keys(TRADER_LABEL);
export const EXPERIENCE_LEVELS = Object.keys(EXPERIENCE_LABEL);
export const MARKETS = Object.keys(MARKET_LABEL);

export const INDIAN_STATES_AND_UTS = [
  ["andhra_pradesh", "Andhra Pradesh"],
  ["arunachal_pradesh", "Arunachal Pradesh"],
  ["assam", "Assam"],
  ["bihar", "Bihar"],
  ["chhattisgarh", "Chhattisgarh"],
  ["goa", "Goa"],
  ["gujarat", "Gujarat"],
  ["haryana", "Haryana"],
  ["himachal_pradesh", "Himachal Pradesh"],
  ["jharkhand", "Jharkhand"],
  ["karnataka", "Karnataka"],
  ["kerala", "Kerala"],
  ["madhya_pradesh", "Madhya Pradesh"],
  ["maharashtra", "Maharashtra"],
  ["manipur", "Manipur"],
  ["meghalaya", "Meghalaya"],
  ["mizoram", "Mizoram"],
  ["nagaland", "Nagaland"],
  ["odisha", "Odisha"],
  ["punjab", "Punjab"],
  ["rajasthan", "Rajasthan"],
  ["sikkim", "Sikkim"],
  ["tamil_nadu", "Tamil Nadu"],
  ["telangana", "Telangana"],
  ["tripura", "Tripura"],
  ["uttar_pradesh", "Uttar Pradesh"],
  ["uttarakhand", "Uttarakhand"],
  ["west_bengal", "West Bengal"],
  ["andaman_and_nicobar_islands", "Andaman and Nicobar Islands"],
  ["chandigarh", "Chandigarh"],
  ["dadra_and_nagar_haveli_and_daman_and_diu", "Dadra and Nagar Haveli and Daman and Diu"],
  ["delhi", "Delhi"],
  ["jammu_and_kashmir", "Jammu and Kashmir"],
  ["ladakh", "Ladakh"],
  ["lakshadweep", "Lakshadweep"],
  ["puducherry", "Puducherry"],
];

export const EMPTY_PROFILE = {
  state: "",
  occupation: "",
  annual_income: "",
  trader_type: "",
  trading_experience: "",
  trading_capital: "",
  trading_capital_range: "",
  markets_traded: [],
  markets_interested: [],
  broker_name: "",
  broker_unique_id: "",
  broker_account_status: "",
  expected_group_profit: "",
  product_in_use: "",
  membership_enabled: "",
  follow_up_routine: "",
  club_next_follow_up_at: "",
};

/** Strips blanks and drops trading detail for a non-trader before sending to the API. */
export function profilePayload(profile) {
  const payload = {};
  if (profile.state) payload.state = profile.state;
  if (profile.occupation) payload.occupation = profile.occupation;
  if (profile.annual_income) payload.annual_income = profile.annual_income;
  if (profile.trader_type) payload.trader_type = profile.trader_type;
  if (profile.markets_interested?.length) payload.markets_interested = profile.markets_interested;
  if ((profile.tags || []).includes("50-cr-club")) {
    payload.broker_name = profile.broker_name?.trim() || null;
    payload.broker_unique_id = profile.broker_unique_id?.trim() || null;
    payload.broker_account_status = profile.broker_account_status || null;
    payload.expected_group_profit = profile.expected_group_profit === "" || profile.expected_group_profit == null
      ? null
      : Number(profile.expected_group_profit);
    payload.product_in_use = profile.product_in_use === "yes" ? true : profile.product_in_use === "no" ? false : null;
    payload.membership_enabled = profile.membership_enabled === "yes" ? true : profile.membership_enabled === "no" ? false : null;
    payload.follow_up_routine = profile.follow_up_routine?.trim() || null;
    payload.club_next_follow_up_at = profile.club_next_follow_up_at
      ? new Date(profile.club_next_follow_up_at).toISOString()
      : null;
  }
  if (profile.trader_type === "trader") {
    if (profile.trading_experience) payload.trading_experience = profile.trading_experience;
    payload.trading_capital_range = profile.trading_capital_range || null;
    payload.trading_capital = profile.trading_capital_range
      ? CAPITAL_RANGE_BY_KEY[profile.trading_capital_range][2]
      : null;
    if (profile.markets_traded?.length) payload.markets_traded = profile.markets_traded;
  }
  return payload;
}

export function profileFromLead(lead = {}) {
  return {
    state: lead.state || "",
    occupation: lead.occupation || "",
    annual_income: lead.annual_income || "",
    trader_type: lead.trader_type || "",
    trading_experience: lead.trading_experience || "",
    trading_capital: lead.trading_capital ?? "",
    trading_capital_range: lead.trading_capital_range || capitalRangeFromValue(lead.trading_capital),
    markets_traded: lead.markets_traded || [],
    markets_interested: lead.markets_interested || [],
    tags: lead.tags || [],
    broker_name: lead.broker_name || "",
    broker_unique_id: lead.broker_unique_id || "",
    broker_account_status: lead.broker_account_status || "",
    expected_group_profit: lead.expected_group_profit ?? "",
    product_in_use: lead.product_in_use === true ? "yes" : lead.product_in_use === false ? "no" : "",
    membership_enabled: lead.membership_enabled === true ? "yes" : lead.membership_enabled === false ? "no" : "",
    follow_up_routine: lead.follow_up_routine || "",
    club_next_follow_up_at: lead.club_next_follow_up_at ? new Date(lead.club_next_follow_up_at).toISOString().slice(0, 16) : "",
  };
}
