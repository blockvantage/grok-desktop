import { describe, it, expect } from "vitest";
import { followUpSuccessNavState } from "./follow-up-nav";

describe("followUpSuccessNavState", () => {
  it("opens workspace on new turn", () => {
    expect(followUpSuccessNavState("t-new")).toEqual({
      selectedId: "t-new",
      taskSurface: "workspace",
      nav: "tasks",
    });
  });
});
