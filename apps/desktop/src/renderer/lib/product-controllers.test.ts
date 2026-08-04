import { describe, expect, it } from "vitest";
import * as controllers from "./product-controllers";

describe("product-controllers barrel", () => {
  it("exports account, activity, browser, queue, layout, activation APIs", () => {
    expect(typeof controllers.createAccountController).toBe("function");
    expect(typeof controllers.reduceActivity).toBe("function");
    expect(typeof controllers.reduceBrowserCapability).toBe("function");
    expect(typeof controllers.claimDurable).toBe("function");
    expect(typeof controllers.layoutForConversation).toBe("function");
    expect(typeof controllers.activationStarterGoal).toBe("function");
  });
});
