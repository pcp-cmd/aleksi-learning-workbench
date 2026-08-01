import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  blockTypeSchema,
  cardCreateInputSchema,
  cardRecordSchema,
  cardTypeSchema,
  cardUpdateInputSchemas,
  counterexampleCardRecordSchema,
  definitionCardCreateInputSchema,
  definitionCardRecordSchema,
  exampleCardRecordSchema,
  linkSafeStringSchema,
  parseCardUpdateInput,
  persistedMasterySchema,
  proofCardRecordSchema,
  reviewIdSchema,
  revisionEntrySchema
} from "../../server/domain/schemas";
import type { CardRecord } from "../../server/domain/types";
import {
  parseCardMarkdown,
  parseCardMarkdownBytes,
  serializeCardMarkdown
} from "../../server/lib/markdown-codec";
import { CARD_TYPES } from "../../shared/card-types";

const FRONTMATTER_KEYS = [
  "id",
  "type",
  "title",
  "concept",
  "relatedConcepts",
  "sourceReading",
  "blockType",
  "mastery",
  "createdAt",
  "nextReview",
  "lastAppliedReviewId",
  "lastAppliedReviewSequence",
  "reviewAppliedAt",
  "reviewOverrideAt",
  "pendingReviewId"
];

const SPECIAL_VALUE =
  "first\n## 正式定义\n```ts\nconst snow = \"雪\";\n```\n" +
  "<!-- /aleksi:value -->\nlast";
const VALID_REVIEW_ID = `review-${"a".repeat(64)}`;

const commonRecord = {
  title: "Compactness",
  concept: "Topology",
  relatedConcepts: ["Open cover", "Finite subcover"],
  sourceReading: "01-阅读材料/topology.md",
  excerpt: "A cover has a finite subcover.",
  understanding: "Compactness controls infinite covers.",
  blockType: "definition",
  nextAction: "Build a counterexample.",
  mastery: "learning",
  createdAt: "2026-06-22T03:14:15.926Z",
  nextReview: "2026-06-23",
  lastAppliedReviewId: null,
  lastAppliedReviewSequence: null,
  reviewAppliedAt: null,
  reviewOverrideAt: null,
  pendingReviewId: null,
  revisionLog: [
    {
      at: "2026-06-22",
      note: "创建卡片",
      reviewId: null
    }
  ]
} as const;

const definitionCard = definitionCardRecordSchema.parse({
    ...commonRecord,
    id: "11111111-1111-4111-8111-111111111111",
    type: "definition",
    formalDefinition: SPECIAL_VALUE,
    plainExplanation: "Every open cover can be reduced to finitely many sets.",
    quantifierStructure: "",
    commonMisunderstandings: "",
    revisionLog: [
      ...commonRecord.revisionLog,
      {
        at: "2026-06-23",
        note: "复习后澄清量词",
        reviewId: VALID_REVIEW_ID
      }
    ]
});

const exampleCard = exampleCardRecordSchema.parse({
    ...commonRecord,
    id: "22222222-2222-4222-8222-222222222222",
    type: "example",
    exampleContent: "[0, 1] in the usual topology.",
    whyItFits: "Heine-Borel gives a finite subcover.",
    trainingPurpose: ""
});

const counterexampleCard = counterexampleCardRecordSchema.parse({
    ...commonRecord,
    id: "33333333-3333-4333-8333-333333333333",
    type: "counterexample",
    counterexampleContent: "The real line with its usual topology.",
    brokenCondition: "The cover by (-n, n) has no finite subcover.",
    whyItIsNot: "Every finite choice misses points."
});

const proofCard = proofCardRecordSchema.parse({
    ...commonRecord,
    id: "44444444-4444-4444-8444-444444444444",
    type: "proof",
    proposition: "A closed subset of a compact space is compact.",
    firstAttempt: "",
    keyMove: "Add the open complement to the cover.",
    proofOutline: "Extend the cover, take a finite subcover, remove the complement.",
    failureReason: ""
});

const cards = {
  definition: definitionCard,
  example: exampleCard,
  counterexample: counterexampleCard,
  proof: proofCard
} satisfies Record<string, CardRecord>;

const genericCardRecords = [
  {
    ...commonRecord,
    id: "55555555-5555-4555-8555-555555555555",
    type: "concept",
    title: "Learning loop",
    concept: "Learning loops",
    formalExplanation: "A learning loop captures input, practice, feedback, and adjustment.",
    myUnderstanding: "It turns one study session into evidence for the next session.",
    commonMisunderstanding: "Treating rereading time as proof of progress.",
    usageContext: "Use after reading or practice."
  },
  {
    ...commonRecord,
    id: "66666666-6666-4666-8666-666666666666",
    type: "boundary",
    title: "Loop vs schedule",
    concept: "Learning loops",
    confusingObjects: "Learning loop vs review schedule",
    similarity: "Both organize repeated study.",
    keyDifference: "The loop changes action from feedback; the schedule only chooses timing.",
    judgementRule: "If feedback changes the next action, classify it as a loop."
  },
  {
    ...commonRecord,
    id: "77777777-7777-4777-8777-777777777777",
    type: "process",
    title: "Repair a failed exercise",
    concept: "Learning loops",
    task: "Convert a failed exercise into a retry plan.",
    steps: "Name the failure, find the cause, write the signal, schedule a retry.",
    keyTurn: "The cause must explain why the wrong move felt plausible.",
    pitfall: "Writing advice too vague to execute.",
    usageContext: "Use after practice."
  },
  {
    ...commonRecord,
    id: "88888888-8888-4888-8888-888888888888",
    type: "mistake",
    title: "Passive rereading",
    concept: "Learning loops",
    mistake: "I reread notes instead of testing recall.",
    originalThinking: "More exposure would create understanding.",
    realCause: "No retrieval attempt exposed the missing step.",
    correctMethod: "Close the note and answer one concrete prompt.",
    recognitionSignal: "I feel fluent only while the note is visible."
  }
] as const;

const createInputs = {
  definition: {
    type: "definition",
    title: "Compactness",
    concept: "Topology",
    relatedConcepts: ["Open cover"],
    sourceReadingId: "reading-1",
    excerpt: "excerpt",
    understanding: "",
    blockType: null,
    nextAction: "",
    formalDefinition: "formal",
    plainExplanation: "plain",
    quantifierStructure: "",
    commonMisunderstandings: ""
  },
  example: {
    type: "example",
    title: "Compact interval",
    concept: "Topology",
    relatedConcepts: [],
    sourceReadingId: "reading-1",
    excerpt: "excerpt",
    understanding: "",
    blockType: null,
    nextAction: "",
    exampleContent: "[0, 1]",
    whyItFits: "It is closed and bounded.",
    trainingPurpose: ""
  },
  counterexample: {
    type: "counterexample",
    title: "Noncompact line",
    concept: "Topology",
    relatedConcepts: [],
    sourceReadingId: "reading-1",
    excerpt: "excerpt",
    understanding: "",
    blockType: null,
    nextAction: "",
    counterexampleContent: "R",
    brokenCondition: "No finite subcover",
    whyItIsNot: "The cover escapes every finite choice."
  },
  proof: {
    type: "proof",
    title: "Closed subsets",
    concept: "Topology",
    relatedConcepts: [],
    sourceReadingId: "reading-1",
    excerpt: "excerpt",
    understanding: "",
    blockType: null,
    nextAction: "",
    proposition: "Closed subsets of compact spaces are compact.",
    firstAttempt: "",
    keyMove: "Add the complement.",
    proofOutline: "Extend and reduce the cover.",
    failureReason: ""
  }
} as const;

const updateInputs = {
  definition: {
    title: "Compactness",
    concept: "Topology",
    relatedConcepts: ["Open cover"],
    sourceReadingId: "reading-1",
    excerpt: "excerpt",
    understanding: "",
    blockType: null,
    nextAction: "",
    mastery: "learning",
    formalDefinition: "formal",
    plainExplanation: "plain",
    quantifierStructure: "",
    commonMisunderstandings: ""
  },
  example: {
    title: "Compact interval",
    concept: "Topology",
    relatedConcepts: [],
    sourceReadingId: "reading-1",
    excerpt: "excerpt",
    understanding: "",
    blockType: null,
    nextAction: "",
    mastery: "mastered",
    exampleContent: "[0, 1]",
    whyItFits: "It is closed and bounded.",
    trainingPurpose: ""
  },
  counterexample: {
    title: "Noncompact line",
    concept: "Topology",
    relatedConcepts: [],
    sourceReadingId: "reading-1",
    excerpt: "excerpt",
    understanding: "",
    blockType: null,
    nextAction: "",
    mastery: "rebuild",
    counterexampleContent: "R",
    brokenCondition: "No finite subcover",
    whyItIsNot: "The cover escapes every finite choice."
  },
  proof: {
    title: "Closed subsets",
    concept: "Topology",
    relatedConcepts: [],
    sourceReadingId: "reading-1",
    excerpt: "excerpt",
    understanding: "",
    blockType: null,
    nextAction: "",
    mastery: "learning",
    proposition: "Closed subsets of compact spaces are compact.",
    firstAttempt: "",
    keyMove: "Add the complement.",
    proofOutline: "Extend and reduce the cover.",
    failureReason: ""
  }
} as const;

function valueUnit(heading: string, value: string): string {
  return (
    `## ${heading}\n` +
    `<!-- aleksi:value bytes=${Buffer.byteLength(value, "utf8")} -->\n` +
    `${value}\n` +
    "<!-- /aleksi:value -->\n"
  );
}

function serialize(card: CardRecord): string {
  return serializeCardMarkdown(card);
}

describe("card domain schemas", () => {
  it("exposes the fixed card, block, and persisted-mastery enums", () => {
    expect(cardTypeSchema.options).toEqual([...CARD_TYPES]);
    expect(blockTypeSchema.options).toEqual([
      "definition",
      "example",
      "counterexample",
      "proof-search",
      "technical",
      "expression",
      "transfer",
      "emotion"
    ]);
    expect(persistedMasterySchema.options).toEqual([
      "learning",
      "mastered",
      "rebuild",
      "archived"
    ]);
    expect(persistedMasterySchema.safeParse("due").success).toBe(false);
  });

  it("normalizes link-safe values and rejects normalized duplicates", () => {
    const parsed = definitionCardCreateInputSchema.parse({
      ...createInputs.definition,
      title: "  Cafe\u0301  ",
      concept: "  Topology  ",
      relatedConcepts: ["  Open cover  ", "Finite subcover"]
    });

    expect(parsed.title).toBe("Café");
    expect(parsed.concept).toBe("Topology");
    expect(parsed.relatedConcepts).toEqual([
      "Open cover",
      "Finite subcover"
    ]);

    expect(
      cardCreateInputSchema.safeParse({
        ...createInputs.definition,
        relatedConcepts: ["Cafe\u0301", "Café"]
      }).success
    ).toBe(false);
  });

  it.each(["bad|link", "bad[[link", "bad]]link", "bad/link", "bad\\link", "bad\rline", "bad\nline"])(
    "rejects unsafe link value %j",
    (value) => {
      expect(
        cardCreateInputSchema.safeParse({
          ...createInputs.definition,
          title: value
        }).success
      ).toBe(false);
      expect(
        cardCreateInputSchema.safeParse({
          ...createInputs.definition,
          concept: value
        }).success
      ).toBe(false);
      expect(
        cardCreateInputSchema.safeParse({
          ...createInputs.definition,
          relatedConcepts: [value]
        }).success
      ).toBe(false);
    }
  );

  it("normalizes body CRLF and bare CR without trimming", () => {
    const parsed = definitionCardCreateInputSchema.parse({
      ...createInputs.definition,
      excerpt: "  first\r\nsecond\rthird  ",
      formalDefinition: " formal\r\nline ",
      plainExplanation: " plain\rline "
    });

    expect(parsed.excerpt).toBe("  first\nsecond\nthird  ");
    expect(parsed.formalDefinition).toBe(" formal\nline ");
    expect(parsed.plainExplanation).toBe(" plain\nline ");
    expect(
      cardCreateInputSchema.safeParse({
        ...createInputs.definition,
        excerpt: "bad\u0000value"
      }).success
    ).toBe(false);
  });

  it("defaults optional create fields and rejects unknown or server-owned keys", () => {
    const {
      relatedConcepts: _relatedConcepts,
      understanding: _understanding,
      blockType: _blockType,
      nextAction: _nextAction,
      ...required
    } = createInputs.definition;

    expect(cardCreateInputSchema.parse(required)).toMatchObject({
      relatedConcepts: [],
      understanding: "",
      blockType: null,
      nextAction: ""
    });
    expect(
      cardCreateInputSchema.safeParse({
        ...createInputs.definition,
        id: "server-owned"
      }).success
    ).toBe(false);
    expect(
      cardCreateInputSchema.safeParse({
        ...createInputs.definition,
        mastery: "due"
      }).success
    ).toBe(false);
    expect(
      cardCreateInputSchema.safeParse({
        ...createInputs.definition,
        relativePath: "02-定义卡/card.md"
      }).success
    ).toBe(false);
  });

  it.each(Object.keys(updateInputs) as Array<keyof typeof updateInputs>)(
    "accepts a complete strict %s update through its keyed schema",
    (type) => {
      expect(cardUpdateInputSchemas[type].parse(updateInputs[type])).toEqual(
        updateInputs[type]
      );
      expect(parseCardUpdateInput(type, updateInputs[type])).toEqual(
        updateInputs[type]
      );
    }
  );

  it("rejects incomplete, unknown, immutable, null, due, and archived updates", () => {
    const { title: _title, ...missingTitle } = updateInputs.definition;

    expect(
      cardUpdateInputSchemas.definition.safeParse(missingTitle).success
    ).toBe(false);
    expect(
      cardUpdateInputSchemas.definition.safeParse({
        ...updateInputs.definition,
        nextReview: "2026-06-24"
      }).success
    ).toBe(false);
    expect(
      cardUpdateInputSchemas.definition.safeParse({
        ...updateInputs.definition,
        type: "definition"
      }).success
    ).toBe(false);
    expect(
      cardUpdateInputSchemas.definition.safeParse({
        ...updateInputs.definition,
        title: null
      }).success
    ).toBe(false);
    expect(
      cardUpdateInputSchemas.definition.safeParse({
        ...updateInputs.definition,
        mastery: "due"
      }).success
    ).toBe(false);
    expect(
      cardUpdateInputSchemas.definition.safeParse({
        ...updateInputs.definition,
        mastery: "archived"
      }).success
    ).toBe(false);
  });

  it("requires applied review id, sequence, and timestamp to be all null or all present", () => {
    expect(cardRecordSchema.parse(cards.example)).toMatchObject({
      lastAppliedReviewId: null,
      lastAppliedReviewSequence: null,
      reviewAppliedAt: null
    });

    const allPresent = {
      ...cards.example,
      lastAppliedReviewId: VALID_REVIEW_ID,
      lastAppliedReviewSequence: 1,
      reviewAppliedAt: "2026-06-23T03:14:15.926Z"
    };
    expect(cardRecordSchema.safeParse(allPresent).success).toBe(true);

    for (const partial of [
      { lastAppliedReviewId: VALID_REVIEW_ID },
      { lastAppliedReviewSequence: 1 },
      { reviewAppliedAt: "2026-06-23T03:14:15.926Z" }
    ]) {
      expect(
        cardRecordSchema.safeParse({
          ...cards.example,
          ...partial
        }).success
      ).toBe(false);
    }

    expect(
      cardRecordSchema.safeParse({
        ...allPresent,
        lastAppliedReviewSequence: 0
      }).success
    ).toBe(false);
    expect(
      cardRecordSchema.safeParse({
        ...allPresent,
        lastAppliedReviewSequence: Number.MAX_SAFE_INTEGER
      }).success
    ).toBe(true);
    expect(
      cardRecordSchema.safeParse({
        ...allPresent,
        lastAppliedReviewSequence: Number.MAX_SAFE_INTEGER + 1
      }).success
    ).toBe(false);
  });

  it("requires deterministic SHA-256 review IDs everywhere they are persisted", () => {
    expect(reviewIdSchema.parse(VALID_REVIEW_ID)).toBe(VALID_REVIEW_ID);
    expect(
      cardRecordSchema.safeParse({
        ...cards.example,
        pendingReviewId: VALID_REVIEW_ID
      }).success
    ).toBe(true);

    const invalidReviewIds = [
      "review-abc123",
      "11111111-1111-4111-8111-111111111111",
      `review-${"a".repeat(63)}`,
      `review-${"a".repeat(65)}`,
      `review-${"A".repeat(64)}`,
      `review-${"g".repeat(64)}`
    ];

    for (const reviewId of invalidReviewIds) {
      expect(reviewIdSchema.safeParse(reviewId).success).toBe(false);
      expect(
        revisionEntrySchema.safeParse({
          at: "2026-06-23",
          note: "reviewed",
          reviewId
        }).success
      ).toBe(false);
      expect(
        cardRecordSchema.safeParse({
          ...cards.example,
          lastAppliedReviewId: reviewId,
          lastAppliedReviewSequence: 1,
          reviewAppliedAt: "2026-06-23T03:14:15.926Z"
        }).success
      ).toBe(false);
      expect(
        cardRecordSchema.safeParse({
          ...cards.example,
          pendingReviewId: reviewId
        }).success
      ).toBe(false);
    }
  });

  it("keeps persisted records strict and revision entries nonempty", () => {
    expect(
      cardRecordSchema.safeParse({
        ...cards.proof,
        relativePath: "05-证明卡/card.md"
      }).success
    ).toBe(false);
    expect(
      revisionEntrySchema.safeParse({
        at: "2026-06-22",
        note: "",
        reviewId: null
      }).success
    ).toBe(false);
  });

  it("closes revision entries over the canonical bullet grammar", () => {
    expect(
      revisionEntrySchema.safeParse({
        at: "2026-06-22",
        note: `[review:${VALID_REVIEW_ID}] server note`,
        reviewId: null
      }).success
    ).toBe(false);
    expect(
      revisionEntrySchema.parse({
        at: "2026-06-22",
        note: "[review:review-abc123] literal note",
        reviewId: null
      })
    ).toEqual({
      at: "2026-06-22",
      note: "[review:review-abc123] literal note",
      reviewId: null
    });

    for (const note of ["first\nsecond", "first\rsecond", "first\u0000second"]) {
      expect(
        revisionEntrySchema.safeParse({
          at: "2026-06-22",
          note,
          reviewId: null
        }).success
      ).toBe(false);
    }

    for (const reviewId of [
      "review-bad]",
      "review bad",
      "review\nbad",
      "review\rbad",
      "review\u0000bad"
    ]) {
      expect(
        revisionEntrySchema.safeParse({
          at: "2026-06-22",
          note: "valid note",
          reviewId
        }).success
      ).toBe(false);
    }

    expect(
      revisionEntrySchema.parse({
        at: "2026-06-22",
        note: "created",
        reviewId: null
      })
    ).toEqual({
      at: "2026-06-22",
      note: "created",
      reviewId: null
    });
    expect(
      revisionEntrySchema.parse({
        at: "2026-06-23",
        note: "reviewed",
        reviewId: VALID_REVIEW_ID
      })
    ).toEqual({
      at: "2026-06-23",
      note: "reviewed",
      reviewId: VALID_REVIEW_ID
    });
  });

  it.each([
    ["title high surrogate", { title: "bad\uD800" }],
    ["concept low surrogate", { concept: "bad\uDC00" }],
    ["body high surrogate", { excerpt: "bad\uD800" }],
    [
      "revision note low surrogate",
      {
        revisionLog: [
          {
            at: "2026-06-22",
            note: "bad\uDC00",
            reviewId: null
          }
        ]
      }
    ]
  ])("rejects non-well-formed strings in %s", (_label, override) => {
    expect(
      cardRecordSchema.safeParse({
        ...cards.example,
        ...override
      }).success
    ).toBe(false);
  });

  it("accepts valid surrogate-pair emoji without altering it", () => {
    expect(linkSafeStringSchema.parse("  emoji 😀  ")).toBe("emoji 😀");

    const parsed = exampleCardRecordSchema.parse({
      ...cards.example,
      title: "Compactness 😀",
      concept: "Topology 😀",
      excerpt: "body 😀"
    });

    expect(parsed.title).toBe("Compactness 😀");
    expect(parsed.concept).toBe("Topology 😀");
    expect(parsed.excerpt).toBe("body 😀");
  });
});

describe("canonical card Markdown codec", () => {
  it("reads unversioned v1 cards with explicit compatibility defaults", () => {
    const markdown = serialize(cards.example);

    expect(markdown).not.toContain("schemaVersion:");
    expect(parseCardMarkdown(markdown)).toMatchObject({
      schemaVersion: 1,
      compatibleMetadata: {}
    });
  });

  it("round trips v2 headings and compatible frontmatter metadata", () => {
    const card = cardRecordSchema.parse({
      ...genericCardRecords[0],
      schemaVersion: 2,
      compatibleMetadata: {
        futureFlag: true,
        provenanceHint: {
          source: "迁移测试",
          formulas: ["$x^2$", "| A |"]
        }
      },
      excerpt: "| 对象 | 性质 |\n| --- | --- |\n| $x$ | 连续 |",
      understanding: "我能闭卷说明 $x \\mapsto x^2$ 为什么连续。",
      myUnderstanding: "把定义、例子与边界整合成一条可复述的判断链。"
    });

    const markdown = serializeCardMarkdown(card);

    expect(markdown).toContain("schemaVersion: 2\n");
    expect(markdown).toContain("## 闭卷重述\n");
    expect(markdown).toContain("## 整合理解\n");
    expect(markdown.match(/^## 闭卷重述$/gmu)).toHaveLength(1);
    expect(markdown.match(/^## 整合理解$/gmu)).toHaveLength(1);
    expect(markdown.indexOf("futureFlag:")).toBeLessThan(
      markdown.indexOf("provenanceHint:")
    );
    expect(parseCardMarkdown(markdown)).toEqual(card);
    expect(serializeCardMarkdown(parseCardMarkdown(markdown))).toBe(markdown);
  });

  it("rejects compatible metadata that overrides reserved card fields", () => {
    expect(() =>
      cardRecordSchema.parse({
        ...cards.example,
        schemaVersion: 2,
        compatibleMetadata: { title: "shadow title" }
      })
    ).toThrow();
  });

  it.each(Object.keys(cards) as Array<keyof typeof cards>)(
    "round trips the exact %s record with Obsidian links and null provenance",
    (type) => {
      const expected = cardRecordSchema.parse(cards[type]);
      const markdown = serialize(cards[type]);

      expect(markdown).toContain(`所属概念：[[${expected.concept}]]`);
      expect(markdown).toContain(
        "相关概念：[[Open cover]]、[[Finite subcover]]"
      );
      expect(markdown).not.toContain("\r");
      expect(markdown.endsWith("\n")).toBe(true);
      expect(markdown.endsWith("\n\n")).toBe(false);
      expect(parseCardMarkdown(markdown)).toEqual(expected);
    }
  );

  it.each(Object.keys(cards) as Array<keyof typeof cards>)(
    "is byte-stable across serialize-parse-serialize for %s cards",
    (type) => {
      const markdown = serialize(cards[type]);

      expect(serializeCardMarkdown(parseCardMarkdown(markdown))).toBe(markdown);
    }
  );

  it("uses the exact frontmatter order and type-specific H1 labels", () => {
    const h1ByType: Record<string, string> = {
      definition: "# 定义卡：Compactness",
      example: "# 例子卡：Compactness",
      counterexample: "# 反例卡：Compactness",
      proof: "# 证明卡：Compactness"
    };

    for (const type of Object.keys(cards) as Array<keyof typeof cards>) {
      const lines = serialize(cards[type]).split("\n");
      expect(lines[0]).toBe("---");
      expect(lines.slice(1, 16).map((line) => line.split(":")[0])).toEqual(
        FRONTMATTER_KEYS
      );
      expect(lines[16]).toBe("---");
      expect(lines[17]).toBe("");
      expect(lines[18]).toBe(h1ByType[type]);
    }
  });

  it("round trips V0.2 generic concept, boundary, process, and mistake cards", () => {
    for (const genericCardRecord of genericCardRecords) {
      const expected = cardRecordSchema.parse(genericCardRecord);
      const markdown = serialize(expected);

      expect(markdown).toContain(`[[${expected.concept}]]`);
      expect(markdown).not.toContain("\r");
      expect(parseCardMarkdown(markdown)).toEqual(expected);
    }
  });

  it("emits the normative zero-byte value unit exactly", () => {
    const markdown = serialize(cards.definition);
    const exact =
      "## 量词结构\n" +
      "<!-- aleksi:value bytes=0 -->\n" +
      "\n" +
      "<!-- /aleksi:value -->\n";

    expect(markdown).toContain(exact);
    expect(parseCardMarkdown(markdown)).toEqual(
      cardRecordSchema.parse(cards.definition)
    );

    expect(() =>
      parseCardMarkdown(markdown.replace(exact, exact.replace("\n\n", "\n")))
    ).toThrow();
    expect(() =>
      parseCardMarkdown(markdown.replace(exact, exact.replace("\n\n", "\n\n\n")))
    ).toThrow();
  });

  it("reads reserved-looking headings, backticks, Unicode, and closing markers by UTF-8 byte count", () => {
    const markdown = serialize(cards.definition);
    const expectedMarker =
      `<!-- aleksi:value bytes=${Buffer.byteLength(SPECIAL_VALUE, "utf8")} -->`;

    expect(markdown).toContain(expectedMarker);
    expect(
      definitionCardRecordSchema.parse(parseCardMarkdown(markdown))
        .formalDefinition
    ).toBe(SPECIAL_VALUE);
  });

  it("parses valid canonical UTF-8 bytes and rejects invalid bytes or a byte BOM", () => {
    const markdown = serialize(cards.example);

    expect(parseCardMarkdownBytes(Buffer.from(markdown, "utf8"))).toEqual(
      cards.example
    );
    expect(() =>
      parseCardMarkdownBytes(Uint8Array.from([0xff]))
    ).toThrow(/UTF-8/);
    expect(() =>
      parseCardMarkdownBytes(
        Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from(markdown, "utf8")])
      )
    ).toThrow(/BOM/);
  });

  it("rejects lone surrogates before parsing trusted decoded strings", () => {
    const markdown = serialize(cards.example);

    expect(() => parseCardMarkdown(`\uD800${markdown}`)).toThrow(
      /well-formed/
    );
    expect(() => parseCardMarkdown(`${markdown.slice(0, -1)}\uDC00\n`)).toThrow(
      /well-formed/
    );
  });

  it("round trips emoji byte counts and a value ending in LF", () => {
    const card = exampleCardRecordSchema.parse({
      ...cards.example,
      title: "Compactness 😀",
      excerpt: "emoji 😀\n"
    });
    const markdown = serializeCardMarkdown(card);

    expect(markdown).toContain(
      `<!-- aleksi:value bytes=${Buffer.byteLength(card.excerpt, "utf8")} -->\n` +
        "emoji 😀\n\n" +
        "<!-- /aleksi:value -->"
    );
    expect(parseCardMarkdown(markdown)).toEqual(card);
    expect(serializeCardMarkdown(parseCardMarkdown(markdown))).toBe(markdown);
  });

  it("round trips revision entries with and without review IDs", () => {
    const parsed = parseCardMarkdown(serialize(cards.definition));

    expect(parsed.revisionLog).toEqual([
      {
        at: "2026-06-22",
        note: "创建卡片",
        reviewId: null
      },
      {
        at: "2026-06-23",
        note: "复习后澄清量词",
        reviewId: VALID_REVIEW_ID
      }
    ]);
  });

  it("round trips a nonmatching literal review prefix as a null-review note", () => {
    const card = exampleCardRecordSchema.parse({
      ...cards.example,
      revisionLog: [
        {
          at: "2026-06-22",
          note: "[review:review-abc123] literal note",
          reviewId: null
        }
      ]
    });
    const markdown = serializeCardMarkdown(card);

    expect(markdown).toContain(
      "- 2026-06-22：[review:review-abc123] literal note\n"
    );
    expect(parseCardMarkdown(markdown)).toEqual(card);
    expect(serializeCardMarkdown(parseCardMarkdown(markdown))).toBe(markdown);
  });

  it("omits empty optional shared sections and verifies block labels", () => {
    const card = {
      ...cards.example,
      understanding: "",
      blockType: null,
      nextAction: ""
    };
    const withoutOptional = serialize(card);

    expect(withoutOptional).not.toContain("## 我的理解");
    expect(withoutOptional).not.toContain("## 当前卡点");
    expect(withoutOptional).not.toContain("## 下一步行动");

    const withBlock = serialize(cards.example);
    expect(withBlock).toContain(valueUnit("当前卡点", "定义"));
    expect(() =>
      parseCardMarkdown(
        withBlock.replace(
          valueUnit("当前卡点", "定义"),
          valueUnit("当前卡点", "例子")
        )
      )
    ).toThrow();
  });

  it("rejects malformed byte counts", () => {
    const markdown = serialize(cards.definition);
    const bytes = Buffer.byteLength(SPECIAL_VALUE, "utf8");

    expect(() =>
      parseCardMarkdown(
        markdown.replace(`bytes=${bytes}`, `bytes=${bytes + 1}`)
      )
    ).toThrow();
    expect(() =>
      parseCardMarkdown(
        markdown.replace(`bytes=${bytes}`, `bytes=${bytes - 1}`)
      )
    ).toThrow();
  });

  it("rejects BOM, CR, and invalid final newlines", () => {
    const markdown = serialize(cards.counterexample);

    expect(() => parseCardMarkdown(`\uFEFF${markdown}`)).toThrow();
    expect(() =>
      parseCardMarkdown(markdown.replace("\n", "\r\n"))
    ).toThrow();
    expect(() => parseCardMarkdown(markdown.slice(0, -1))).toThrow();
    expect(() => parseCardMarkdown(`${markdown}\n`)).toThrow();
  });

  it("rejects wrong section order and unknown or duplicate sections", () => {
    const simple = serialize({
      ...cards.definition,
      formalDefinition: "formal",
      plainExplanation: "plain"
    });
    const formal = valueUnit("正式定义", "formal");
    const plain = valueUnit("大白话解释", "plain");

    expect(() =>
      parseCardMarkdown(
        simple.replace(`${formal}\n${plain}`, `${plain}\n${formal}`)
      )
    ).toThrow();
    expect(() =>
      parseCardMarkdown(
        simple.replace(
          "\n## 修订记录\n",
          `\n${valueUnit("未知章节", "value")}\n## 修订记录\n`
        )
      )
    ).toThrow();
    expect(() =>
      parseCardMarkdown(
        simple.replace(
          `${formal}\n${plain}`,
          `${formal}\n${formal}\n${plain}`
        )
      )
    ).toThrow();
  });

  it("rejects mismatched mirrored links and duplicate frontmatter keys", () => {
    const markdown = serialize(cards.example);

    expect(() =>
      parseCardMarkdown(
        markdown.replace(
          "所属概念：[[Topology]]",
          "所属概念：[[Analysis]]"
        )
      )
    ).toThrow();
    expect(() =>
      parseCardMarkdown(
        markdown.replace(
          'title: "Compactness"\n',
          'title: "Compactness"\ntitle: "Compactness"\n'
        )
      )
    ).toThrow();
  });

  it("round trips canonical revision bullets with and without review metadata", () => {
    const card = exampleCardRecordSchema.parse({
      ...cards.example,
      revisionLog: [
        {
          at: "2026-06-22",
          note: "created",
          reviewId: null
        },
        {
          at: "2026-06-23",
          note: "reviewed",
          reviewId: VALID_REVIEW_ID
        }
      ]
    });
    const markdown = serializeCardMarkdown(card);

    expect(markdown).toContain("- 2026-06-22：created\n");
    expect(markdown).toContain(
      `- 2026-06-23：[review:${VALID_REVIEW_ID}] reviewed\n`
    );
    expect(parseCardMarkdown(markdown)).toEqual(card);
  });
});
