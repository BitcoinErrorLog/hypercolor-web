import { describe, expect, it } from "vitest";
import { canDismissRecoveryCode, recoveryCodeDisplayState } from "./backup-gate";

describe("backup-gate", () => {
  it("blocks dismiss while a recovery code is on screen and unsaved", () => {
    expect(
      canDismissRecoveryCode({ recoveryCode: "abc", confirmedSaved: false }),
    ).toBe(false);
    expect(
      recoveryCodeDisplayState({ recoveryCode: "abc", confirmedSaved: false }),
    ).toBe("shown");
  });

  it("allows dismiss only after the confirm-saved gate", () => {
    expect(
      canDismissRecoveryCode({ recoveryCode: "abc", confirmedSaved: true }),
    ).toBe(true);
    expect(
      recoveryCodeDisplayState({ recoveryCode: "abc", confirmedSaved: true }),
    ).toBe("ready-to-dismiss");
  });

  it("is hidden when no code is in memory", () => {
    expect(canDismissRecoveryCode({ recoveryCode: null, confirmedSaved: false })).toBe(
      true,
    );
    expect(
      recoveryCodeDisplayState({ recoveryCode: null, confirmedSaved: false }),
    ).toBe("hidden");
  });
});
