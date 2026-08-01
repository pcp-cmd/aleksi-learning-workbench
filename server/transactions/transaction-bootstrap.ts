import { activeLearningLibraryIdentity } from "../persistence/library-context";
import { recoverTransactions } from "./transaction-recovery";
import type { TransactionRecoveryReport } from "./transaction-recovery";

export async function recoverActiveLibraryTransactions(): Promise<
  TransactionRecoveryReport | null
> {
  try {
    const identity = await activeLearningLibraryIdentity();
    return recoverTransactions(identity.path, identity.vaultId);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (
        error.code === "ACTIVE_VAULT_NOT_CONFIGURED" ||
        error.code === "VAULT_NOT_INITIALIZED" ||
        error.code === "VAULT_PATH_NOT_FOUND"
      )
    ) {
      return null;
    }
    throw error;
  }
}
