import type { QueryClient } from "@tanstack/react-query";
import { libraryBackedQueryRoots, queryKeys } from "./query-keys";

export type LibraryMutation =
  | "reading-saved"
  | "card-saved"
  | "review-completed"
  | "verification-changed";

const MUTATION_INVALIDATIONS: Record<
  LibraryMutation,
  readonly (readonly unknown[])[]
> = {
  "reading-saved": [
    queryKeys.readings.all,
    queryKeys.today.all,
    queryKeys.graph.all
  ],
  "card-saved": [
    queryKeys.cards.all,
    queryKeys.today.all,
    queryKeys.graph.all,
    queryKeys.review.all,
    queryKeys.verification.all
  ],
  "review-completed": [
    queryKeys.review.all,
    queryKeys.today.all,
    queryKeys.graph.all,
    queryKeys.cards.all
  ],
  "verification-changed": [
    queryKeys.verification.all,
    queryKeys.cards.all,
    queryKeys.today.all,
    queryKeys.graph.all
  ]
};

export async function invalidateAfterMutation(
  queryClient: QueryClient,
  mutation: LibraryMutation
): Promise<void> {
  await Promise.all(
    MUTATION_INVALIDATIONS[mutation].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey })
    )
  );
}

export function resetLibraryBackedQueries(queryClient: QueryClient): void {
  libraryBackedQueryRoots.forEach((queryKey) => {
    queryClient.removeQueries({ queryKey });
  });
}
