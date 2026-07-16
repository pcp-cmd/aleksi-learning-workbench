# Markdown Rendering 2.0 Test

这份文档覆盖 Reader 必须稳定渲染的常见 Obsidian / GFM Markdown。

## Tables

| Concept | Description | Status |
| :--- | :--- | ---: |
| Schema | Mental structure | 90% |
| Memory | Long-term storage | 75% |

## Task Lists

- [ ] Learn Analysis
- [x] Finish Statistics

## Inline Features

Use `npm install` to install packages. Visit https://openai.com. This is ~~deprecated~~ and this is ==highlighted==.

## Math

Inline math: $x_n \to a$.

Block math:

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

## Code

```ts
const sequence = [1, 2, 3];
const total = sequence.reduce((sum, value) => sum + value, 0);
```

## Blockquote

> Knowledge compounds over time.

## Image

![Local diagram](image.png)

## Horizontal Rule

---

## Footnotes

A small claim with a footnote.[^1]

[^1]: A concise explanation that should render at the bottom.
