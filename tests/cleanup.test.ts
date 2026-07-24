import { describe, expect, it } from "vitest";
import { parseMutationPlan } from "../src/cleanup/apply.js";

describe("parseMutationPlan", () => {
  it("parses a valid plan", () => {
    const plan = parseMutationPlan({
      version: 1,
      mutations: [
        {
          type: "reservation_status",
          id: "r1",
          status: "canceled",
          confirmationCode: "ABC",
        },
        {
          type: "sanitize_guest",
          id: "g1",
          firstName: "Demo",
          lastName: "Guest",
          clearNotes: true,
        },
      ],
      manual: [{ kind: "inbox", summary: "Archive in UI" }],
    });

    expect(plan.mutations).toHaveLength(2);
    expect(plan.mutations[0]).toMatchObject({
      type: "reservation_status",
      status: "canceled",
    });
    expect(plan.manual?.[0].kind).toBe("inbox");
  });

  it("rejects unknown mutation types", () => {
    expect(() =>
      parseMutationPlan({
        version: 1,
        mutations: [{ type: "delete_everything", id: "x" }],
      }),
    ).toThrow(/Unknown mutation type/);
  });
});
