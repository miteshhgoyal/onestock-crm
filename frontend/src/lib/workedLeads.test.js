import { isLeadWorked, isLeadUnworked, UNWORKED_STATUSES } from "./constants";

describe("Worked / Unworked lead definition", () => {
  test("new_lead and assigned without call outcome are unworked", () => {
    expect(isLeadUnworked({ status: "new_lead" })).toBe(true);
    expect(isLeadWorked({ status: "new_lead" })).toBe(false);

    expect(isLeadUnworked({ status: "assigned" })).toBe(true);
    expect(isLeadWorked({ status: "assigned" })).toBe(false);
  });

  test("Not connected and Not picked up count as worked", () => {
    expect(isLeadWorked({ status: "not_connected" })).toBe(true);
    expect(isLeadUnworked({ status: "not_connected" })).toBe(false);

    expect(isLeadWorked({ status: "not_picked_up" })).toBe(true);
    expect(isLeadUnworked({ status: "not_picked_up" })).toBe(false);
  });

  test("Follow-up, Interested, Not Interested, Converted, Lost count as worked", () => {
    const statuses = ["follow_up", "interested", "not_interested", "converted", "lost", "contacted"];
    statuses.forEach((status) => {
      expect(isLeadWorked({ status })).toBe(true);
      expect(isLeadUnworked({ status })).toBe(false);
    });
  });

  test("assigned lead with a call outcome logged counts as worked", () => {
    expect(isLeadWorked({ status: "assigned", last_call_outcome: "not_connected" })).toBe(true);
    expect(isLeadUnworked({ status: "assigned", last_call_outcome: "not_connected" })).toBe(false);

    expect(isLeadWorked({
      status: "assigned",
      calls: [{ call_number: 1, call_outcome: "connected" }],
    })).toBe(true);

    expect(isLeadUnworked({
      status: "assigned",
      calls: [{ call_number: 1, call_outcome: null }],
    })).toBe(true);
  });
});
