# UI Reuse Map

Status: frozen for V0.1

## 1. Immutable visual reference

Reference archive:

```text
C:\Users\pcp\Desktop\pcp-cmd.github.io.zip
```

SHA-256:

```text
CF09D3A56886AC20FDA7D690FE2878E9E8EA5C51A8CB5749E1E5E53FEC36531E
```

The archive is read-only. Visual verification must first recompute the hash and
fail with `ALEKSI_REFERENCE_MISMATCH` if it differs. The Workbench reuses the
archive's visual language, not its public-site structure or copy.

## 2. Exact source inventory

| Archive path | Exact source | Workbench target | Preserve | Exclude |
|---|---|---|---|---|
| `pcp-cmd.github.io/assets/css/tokens.css` | `:root` token declarations | `src/styles/tokens.css` | approved dark/warm/clay colors, typography, line, radius, easing, and timing tokens | public-site aliases and unused decorative color families |
| `pcp-cmd.github.io/assets/css/components.css` | `.claude-card`, `.claude-card:hover`, `.claude-card:focus-visible` | learning/context cards | thin border, no glow, raised dark surface, `translateY(-1px)` | exhibition stacking, rotation, large scale |
| `pcp-cmd.github.io/assets/css/layout.css` | `.reading-row.is-selected`, `.reading-row::before` | selected reading/card/review row | clay left mark, soft clay wash, stronger title/action | portfolio/archive metadata |
| `pcp-cmd.github.io/assets/css/components.css` | `.button`, `.button-primary` | app buttons | compact pill, clay primary, bordered secondary, short lift | hero-action composition and links disguised as controls |
| `pcp-cmd.github.io/assets/css/components.css` | `.graph-panel`, `.graph-detail-panel`, `.graph-node.is-active`, `.graph-link.is-active` | flywheel graph and detail drawer | dark research-board field, restrained active node/link, divided detail | topology editing, manual edges, saved free layouts |
| `pcp-cmd.github.io/assets/css/base.css` | `[data-reveal]`, `.no-gsap [data-reveal]` | route entrance/fallback | content visible without animation support | animation-gated content |
| `pcp-cmd.github.io/design-system/components.md` | Card guidance | all card surfaces | “paper objects,” thin borders, no glow, small accent marker | generic SaaS panels |
| `pcp-cmd.github.io/design-system/motion.md` | page load and hover guidance | route, drawer, hover motion | short fade/translate and restrained hover | bounce, large zoom, long loops |
| `pcp-cmd.github.io/assets/css/pages/home.css` and `pcp-cmd.github.io/assets/css/pages/works.css` | `@media (prefers-reduced-motion: reduce)` | global reduced-motion rule | visible content and state without transforms | motion-dependent meaning |

No source selector named `.status-dot` exists in the archive. The Workbench
`StatusDot` is a constrained adaptation of the archive's small accent-marker
motif, not a copied selector.

## 3. Exact token contract

The following tokens are copied with these values:

| Token | Value | Workbench use |
|---|---|---|
| `--bg` | `#10100d` | app background |
| `--surface` | `#171711` | rail, card, reader surface |
| `--surface-raised` | `#1d1b15` | controls and drawer |
| `--surface-soft` | `#211e17` | hover/selected wash |
| `--text-strong` | `#f3f0e7` | titles and primary text |
| `--text` | `#d8d2c5` | body text |
| `--text-muted` | `#aaa294` | metadata |
| `--line` | `rgba(226, 216, 198, 0.14)` | default borders |
| `--line-strong` | `rgba(226, 216, 198, 0.24)` | hover/focus borders |
| `--clay` | `#bf683d` | selected marks and primary actions |
| `--clay-strong` | `#dc8152` | active emphasis |
| `--clay-soft` | `rgba(191, 104, 61, 0.18)` | selected wash |
| `--font-sans` | `Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif` | UI/body |
| `--font-serif` | `"Iowan Old Style", "Baskerville", "Noto Serif SC", "Songti SC", serif` | mathematical reading/title emphasis |
| `--radius-sm` | `10px` | compact controls and small surfaces |
| `--radius-md` | `16px` | rows, panels, and medium controls |
| `--radius-lg` | `24px` | primary cards and drawer surfaces |
| `--ease-out` | `cubic-bezier(.2, .8, .2, 1)` | short interaction motion |
| `--ease-focus` | `cubic-bezier(.16, 1, .3, 1)` | route/drawer motion |
| `--motion-fast` | `150ms` | focus/color |
| `--motion-normal` | `250ms` | route/drawer |
| `--motion-slow` | `400ms` | not used for repeated decoration |
| `--article-main` | `760px` | reader measure |

Public aliases may be omitted only when no app selector references them.

## 4. Six routes and utility surface

| Route path | Chinese route name | Rail position |
|---|---|---:|
| `/today` | 今日学习 | 1 |
| `/reader` | 精读工作台 | 2 |
| `/cards` | 卡片工作台 | 3 |
| `/diagnosis` | 卡点诊断 | 4 |
| `/review` | 飞轮复习 | 5 |
| `/graph` | 飞轮图谱 | 6 |

Settings is a dialog/utility opened from the rail. It is not a seventh workflow
route.

## 5. Frozen layout geometry

Primary visual-test viewport: `1440 × 900` CSS pixels at device scale factor
`1`.

| Element | Measurable contract at baseline |
|---|---|
| Navigation rail | fixed left; `80px` wide; six route controls remain visible without horizontal scrolling |
| Central workspace | starts at `x = 80px`; occupies remaining width; reader text measure is at most `760px` |
| Bottom action band | fixed to workspace bottom; `72px` high; exactly three equal cells: current object, current block, next action |
| Context drawer | on-demand; absent from layout/accessibility tree while closed; fixed right overlay when open; width `400px`; never a permanent third column |
| Reader | central primary surface; inline and block KaTeX stay inside the `760px` measure without horizontal page overflow |
| Status dot | `8px × 8px`; adjacent Chinese text is always present |

At viewport widths below `1024px`, the rail may collapse and the drawer may use
`min(400px, calc(100vw - 32px))`; the central reading flow remains usable.
V0.1 has no full mobile optimization requirement.

## 6. State and motion assertions

### Cards, rows, and buttons

- Resting cards have `1px` borders, `box-shadow: none`, and no glow.
- Card/button hover transform is exactly `translateY(-1px)` or `none`; it may
  not exceed `-2px`.
- Pressed rows/buttons use at most `translateY(1px)`.
- Hover/focus border changes from `--line` to `--line-strong` or an equivalent
  clay border.
- `.reading-row.is-selected` has a visible left marker and a clay-soft
  background wash; selection is not communicated by color alone.
- `:focus-visible` has a visible outline/border with at least `2px` effective
  thickness and is not suppressed without replacement.

### Route entrance and drawer

- Route entrance is one opacity transition plus
  `translateY(8px) → translateY(0)`.
- Route entrance completes within `250ms`; all route content is visible within
  `300ms` of navigation.
- Drawer entrance is opacity plus
  `translateX(16px) → translateX(0)` within `250ms`.
- Closing the drawer returns focus to its trigger. `Escape` closes it.
- No animation repeats indefinitely.

### Reduced motion

With `prefers-reduced-motion: reduce`:

- route, drawer, card, row, and button transforms are `none`;
- animation/transition duration is `0ms` or at most `1ms`;
- open, selected, error, saved, due, and focus states remain visible;
- content is never hidden while waiting for animation code.

## 7. Explicit exclusions

Do not reuse or introduce:

- the public-site hero;
- the exhibition or portfolio wall;
- public-facing product copy;
- oversized display compositions;
- glow, neon, or bright light borders;
- decorative long-running loops;
- exhibition-card stacking, rotation, large lift, or zoom;
- free topology editing, manual edges, or persistent zoom in the flywheel graph;
- generic SaaS dashboard styling.
