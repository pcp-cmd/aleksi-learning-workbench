import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  invalidateAfterMutation,
  resetLibraryBackedQueries
} from "../../src/app/query-invalidation";
import { queryKeys } from "../../src/app/query-keys";

function seededClient() {
  const client = new QueryClient();
  client.setQueryData(queryKeys.vault.status, "vault");
  client.setQueryData(queryKeys.readings.all, "readings");
  client.setQueryData(queryKeys.cards.recent, "cards");
  client.setQueryData(queryKeys.today.next, "today");
  client.setQueryData(queryKeys.graph.state, "graph");
  client.setQueryData(queryKeys.review.today, "review");
  client.setQueryData(queryKeys.verification.all, "verification");
  return client;
}

function invalidated(client: QueryClient, queryKey: readonly unknown[]) {
  return client.getQueryState(queryKey)?.isInvalidated ?? false;
}

describe("mutation-to-query invalidation map", () => {
  it("refreshes every downstream card-save consumer", async () => {
    const client = seededClient();
    await invalidateAfterMutation(client, "card-saved");

    expect(invalidated(client, queryKeys.cards.recent)).toBe(true);
    expect(invalidated(client, queryKeys.today.next)).toBe(true);
    expect(invalidated(client, queryKeys.graph.state)).toBe(true);
    expect(invalidated(client, queryKeys.review.today)).toBe(true);
    expect(invalidated(client, queryKeys.verification.all)).toBe(true);
    expect(invalidated(client, queryKeys.readings.all)).toBe(false);
  });

  it("refreshes review and verification dependents through named mutations", async () => {
    const reviewClient = seededClient();
    await invalidateAfterMutation(reviewClient, "review-completed");
    expect(invalidated(reviewClient, queryKeys.review.today)).toBe(true);
    expect(invalidated(reviewClient, queryKeys.cards.recent)).toBe(true);
    expect(invalidated(reviewClient, queryKeys.today.next)).toBe(true);
    expect(invalidated(reviewClient, queryKeys.graph.state)).toBe(true);

    const verificationClient = seededClient();
    await invalidateAfterMutation(verificationClient, "verification-changed");
    expect(invalidated(verificationClient, queryKeys.verification.all)).toBe(true);
    expect(invalidated(verificationClient, queryKeys.cards.recent)).toBe(true);
    expect(invalidated(verificationClient, queryKeys.today.next)).toBe(true);
    expect(invalidated(verificationClient, queryKeys.graph.state)).toBe(true);
  });

  it("removes all library-backed cache after a library change", () => {
    const client = seededClient();
    client.setQueryData(["desktop-runtime"], "keep");

    resetLibraryBackedQueries(client);

    expect(client.getQueryCache().findAll()).toHaveLength(1);
    expect(client.getQueryData(["desktop-runtime"])).toBe("keep");
  });
});
