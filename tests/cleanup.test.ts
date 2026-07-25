import { describe, expect, it } from "vitest";
import { buildAuditReport, gateThreshold } from "../src/cleanup/audit.js";
import { scoreGuests } from "../src/cleanup/score-guests.js";
import { scoreListingNicknames } from "../src/cleanup/score-listing-nicknames.js";
import { scoreTasks } from "../src/cleanup/score-tasks.js";
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

describe("gateThreshold", () => {
  it("marks MET when value >= threshold", () => {
    const g = gateThreshold("guests", "renameCount", 10, 10);
    expect(g.dirty).toBe(true);
    expect(g.verdict).toBe("MET");
    expect(g.action).toBe("propose");
    expect(g.summary).toContain("10 >= 10");
    expect(g.summary).toContain("MET");
  });

  it("marks NOT MET when value < threshold", () => {
    const g = gateThreshold("tasks", "deleteCount", 40, 100);
    expect(g.dirty).toBe(false);
    expect(g.verdict).toBe("NOT_MET");
    expect(g.action).toBe("skip");
    expect(g.summary).toContain("40 < 100");
    expect(g.summary).toContain("NOT MET");
  });
});

describe("scoreGuests", () => {
  it("counts junk and forbidden names", () => {
    const result = scoreGuests([
      { id: "1", fullName: "Test User", firstName: "Test", lastName: "User" },
      { id: "2", fullName: "Humberto Rinaldi", firstName: "Humberto", lastName: "Rinaldi" },
      { id: "3", fullName: "Jane Smith", firstName: "Jane", lastName: "Smith" },
    ]);
    expect(result.renameCount).toBe(2);
    expect(result.sample.map((s) => s.reason).sort()).toEqual(["forbidden", "junk"]);
  });

  it("flags heavy duplicates", () => {
    const guests = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      fullName: "Alex Demo",
      firstName: "Alex",
      lastName: "Demo",
    }));
    const result = scoreGuests(guests, { duplicateFullNameThreshold: 5 });
    expect(result.renameCount).toBe(5);
    expect(result.sample.every((s) => s.reason === "duplicate")).toBe(true);
  });
});

describe("scoreTasks", () => {
  it("deletes excess over keepPerTitle", () => {
    const tasks = Array.from({ length: 60 }, (_, i) => ({
      _id: `t${i}`,
      title: "Clean unit",
      status: "pending",
      listingId: `l${i}`,
      createdAt: new Date(2024, 0, i + 1).toISOString(),
    }));
    const result = scoreTasks(tasks, { keepPerTitle: 50 });
    expect(result.deleteCount).toBe(10);
    expect(result.keep).toBe(50);
  });
});

describe("scoreListingNicknames", () => {
  it("scores nicknames that do not match GueStay pattern", () => {
    const result = scoreListingNicknames([
      {
        _id: "a",
        title: "Loft",
        nickname: "Old Nick",
        address: { city: "London" },
      },
      {
        _id: "b",
        title: "Condo",
        nickname: "GueStay - Paris",
        address: { city: "Paris" },
      },
    ]);
    expect(result.renameCount).toBe(1);
    expect(result.sample[0]?.after).toBe("GueStay - London");
  });
});

describe("buildAuditReport", () => {
  it("splits thresholdsMet and thresholdsNotMet with explicit numbers", () => {
    const report = buildAuditReport({
      thresholds: {
        guestsRenameCount: 10,
        listingNicknameRenameCount: 3,
        tasksDeleteCount: 100,
      },
      guests: { renameCount: 42, totalGuests: 200, sample: [] },
      listingNicknames: { renameCount: 1, totalListings: 50, sample: [] },
      tasks: {
        deleteCount: 40,
        keep: 200,
        keepableCandidates: 240,
        keepPerTitle: 50,
        exported: 300,
      },
    });

    expect(report.propose).toEqual(["guests"]);
    expect(report.skip).toEqual(["listingNicknames", "tasks"]);
    expect(report.thresholdsMet).toHaveLength(1);
    expect(report.thresholdsMet[0].summary).toBe(
      "guests renameCount 42 >= 10 (MET — propose)",
    );
    expect(report.thresholdsNotMet.map((t) => t.summary)).toEqual([
      "listingNicknames renameCount 1 < 3 (NOT MET — skip)",
      "tasks deleteCount 40 < 100 (NOT MET — skip)",
    ]);
  });
});
