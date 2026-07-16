# Desktop total recovery visual comparison — 2026-07-17

## Scope and evidence identity

- Locked comparison input: `baselines/accepted-browser-total-refinement-20260716/evidence` in the recovery workspace, never modified by this checkout.
- Locked matrix: 27 PNGs — Entrance, Today, Reader, Cards, Flywheel, Review, Diagnosis, Verification, and Settings at 1440×960, 1280×800, and 960×680.
- New browser evidence: `artifacts/total-recovery-browser-evidence-20260717`.
- New source mode: production `dist` served by the packaged Express runtime path, recorded as `production-dist-served-by-express`.
- New matrix: all 27 locked-name counterparts plus Flywheel at 1024×768 and four representative advanced/empty/error states, for 32 PNGs and 32 manifest records.

This is browser production evidence, not installed-EXE evidence. Installed-window comparison remains a separate final gate.

## Automated checks

- Every required locked-matrix filename has a new counterpart.
- The evidence manifest parses as UTF-8 JSON with 32 records.
- All recorded surfaces report no horizontal overflow.
- All records use one consistent computed serif, sans, and mono semantic font stack.
- Primary actions are visible wherever the state has an action. The deterministic Entrance state and empty Review state intentionally have no action.
- The ordinary browser regression excludes the production-evidence test, so a development server cannot overwrite or be labeled as production evidence.
- The real animated entrance path is covered separately; evidence screenshots use the deterministic reduced-motion final glyph.

The locked screenshots were produced by a different browser capture path: 15 of 27 exclude browser scrollbar width/height, while the new Playwright evidence records the exact requested viewport. Pixel comparisons therefore used the overlapping rectangle. Across the 27 pairs, mean absolute RGB difference ranges from 2.41 to 13.88; the remaining difference is dominated by seeded learning content, scrollbar geometry, the planned Flywheel restoration, and recovery-state content rather than a global color or typography replacement.

## Difference classification

| Surface | Classification | Evidence-based interpretation |
| --- | --- | --- |
| Entrance | Explicit plan change | The composition and real local motion asset remain. The new evidence freezes the supported reduced-motion final state instead of capturing an arbitrary animation frame; animation completion, missing asset, retry, and unavailable-backend paths remain separately tested. |
| Today | Required recovery capability | The accepted restrained shell remains. The page resolves to one seeded next action, one primary Start action, quiet follow-up work, and direct Settings recovery. Differences are seeded due-card content and the planned single-action hierarchy. |
| Reader | Required recovery capability | Paper layout, Markdown/math surface, material context, and accepted typography remain. Differences are the isolated reading fixture and URL-restored reading context. |
| Cards | Required recovery capability | Accepted editor/source/recent hierarchy remains. Differences are five seeded card types, selected-card URL context, local draft recovery, and post-save discovery behavior. |
| Flywheel | Explicit plan change | The five-stage Concept → Example → Boundary → Process → Mistake loop was intentionally restored from the selected structural reference. The 1024×768 supplemental image and all required widths show no horizontal overflow; narrow windows continue vertically. |
| Review | Required recovery capability | The prompt/reveal/result hierarchy remains compact. Differences are the isolated due-card fixture, stable card URL context, local response recovery, and the preserved completion receipt while central invalidation refreshes the queue. |
| Diagnosis | Required desktop capability | Diagnosis remains contextual rather than primary. Differences are draft recovery, unsaved-navigation protection, and source/card context carried in the URL/local draft. |
| Verification | Required desktop capability | Default trust summary stays plain-language; ledger, relationships, GPT JSON, and revocation remain behind advanced disclosure. Differences are the isolated accepted evidence record and stable evidence/card URL context. |
| Settings | Required recovery capability | The modal hierarchy remains. Differences are the explicit active/recommended library paths, safe fallback/repair actions, and collapsed advanced controls. The deliberately long isolated Windows path wraps without horizontal overflow. |

## Current disposition

- No P0 or P1 browser visual regression was found in the automated matrix and representative visual review.
- Browser production evidence is suitable as the comparison input for the installed desktop pass.
- It is not yet valid to claim final desktop parity: Rust/MSVC build, installer creation, clean install, installed-EXE screenshots, second-instance/window lifecycle, and uninstall-preserves-library checks still require the explicitly permission-gated native toolchain.
