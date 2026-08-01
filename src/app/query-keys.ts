export const queryKeys = {
  vault: {
    all: ["learning-library"] as const,
    autoPrepare: ["learning-library", "auto-prepare"] as const,
    health: ["learning-library", "health"] as const,
    status: ["learning-library", "status"] as const
  },
  readings: {
    all: ["readings"] as const,
    detail: (id: string) => ["reading", id] as const,
    details: ["reading"] as const
  },
  documents: {
    all: ["documents"] as const,
    detail: (id: string) => ["documents", "detail", id] as const,
    chunk: (id: string, chunkId: string) =>
      ["documents", "chunk", id, chunkId] as const,
    search: (id: string, query: string) =>
      ["documents", "search", id, query] as const
  },
  cards: {
    all: ["cards"] as const,
    library: ["cards", "library"] as const,
    recent: ["cards", "recent"] as const,
    detail: (id: string) => ["cards", "detail", id] as const
  },
  today: {
    all: ["today"] as const,
    next: ["today", "next"] as const
  },
  graph: {
    all: ["graph-state"] as const,
    state: ["graph-state"] as const
  },
  review: {
    all: ["review-today"] as const,
    today: ["review-today"] as const
  },
  verification: {
    all: ["verification"] as const,
    candidate: (id: string) => ["verification", "candidate", id] as const,
    candidates: ["verification", "candidates"] as const,
    knowledge: (cardId: string) => ["verification", "knowledge", cardId] as const
  }
} as const;

export const libraryBackedQueryRoots: readonly (readonly unknown[])[] = [
  queryKeys.vault.all,
  queryKeys.readings.all,
  queryKeys.readings.details,
  queryKeys.documents.all,
  queryKeys.cards.all,
  queryKeys.today.all,
  queryKeys.graph.all,
  queryKeys.review.all,
  queryKeys.verification.all
];
