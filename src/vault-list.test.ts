import { describe, expect, it } from "vitest";
import { maskCardNumber, maskGenericSecret, maskPassword } from "./features/credentials";
import { getRowStatusTone, getStrengthTone, ROW_STATUS_PRIORITY } from "./features/diagnostics";
import { STRENGTH_POLICY } from "./password-strength";

describe("vault list masks", () => {
  it("never reveal length or trailing characters of a secret", () => {
    const short = maskGenericSecret("abc");
    expect(maskGenericSecret("sk-live-1234567890_y_Q")).toBe(short);
    expect(maskGenericSecret("ABCD-EFGH-IJKL")).not.toContain("IJKL");
    expect(maskPassword("x")).toBe(maskPassword("a much longer password"));
  });

  it("keeps the dash for empty values", () => {
    expect(maskGenericSecret("")).toBe("—");
    expect(maskCardNumber(undefined)).toBe("—");
  });

  it("shows only the last four digits of a full card number", () => {
    expect(maskCardNumber("5555 4444 3333 1111")).toBe("•••• 1111");
    expect(maskCardNumber("1234")).not.toContain("1234");
  });
});

describe("vault list status", () => {
  it("leaves weak (shown by the meter) and missing TOTP out of the row chip", () => {
    expect(ROW_STATUS_PRIORITY).not.toContain("weak");
    expect(ROW_STATUS_PRIORITY).not.toContain("missingTotp");
    expect(ROW_STATUS_PRIORITY[0]).toBe("expired");
  });

  it("colours chips and the strength meter by severity", () => {
    expect(getRowStatusTone("expired")).toBe("danger");
    expect(getRowStatusTone("expiring")).toBe("warning");
    expect(getRowStatusTone("incomplete")).toBe("neutral");
    expect(getStrengthTone(STRENGTH_POLICY.mediumMinScore - 1)).toBe("danger");
    expect(getStrengthTone(STRENGTH_POLICY.mediumMinScore)).toBe("warning");
    expect(getStrengthTone(STRENGTH_POLICY.strongMinScore)).toBe("success");
  });
});
