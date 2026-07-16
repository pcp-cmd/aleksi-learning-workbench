import { describe, expect, it } from "vitest";
import { normalizeUserSuppliedVaultPath } from "../../shared/user-path";

describe("user-supplied Vault path normalization", () => {
  it.each([
    ["C:\\Users\\pcp\\Documents\\Aleksi Learning Workbench"],
    [" C:\\Users\\pcp\\Documents\\Aleksi Learning Workbench "],
    ["\"C:\\Users\\pcp\\Documents\\Aleksi Learning Workbench\""],
    ["'C:\\Users\\pcp\\Documents\\Aleksi Learning Workbench'"],
    ["“C:\\Users\\pcp\\Documents\\Aleksi Learning Workbench”"],
    ["‘C:\\Users\\pcp\\Documents\\Aleksi Learning Workbench’"]
  ])("removes only one matched outer quote pair from %j", (input) => {
    expect(normalizeUserSuppliedVaultPath(input)).toBe(
      "C:\\Users\\pcp\\Documents\\Aleksi Learning Workbench"
    );
  });

  it("keeps interior spaces and unmatched quote characters untouched", () => {
    expect(normalizeUserSuppliedVaultPath("C:\\Users\\pcp\\My Vault")).toBe(
      "C:\\Users\\pcp\\My Vault"
    );
    expect(normalizeUserSuppliedVaultPath("\"C:\\Users\\pcp\\My Vault")).toBe(
      "\"C:\\Users\\pcp\\My Vault"
    );
  });
});
