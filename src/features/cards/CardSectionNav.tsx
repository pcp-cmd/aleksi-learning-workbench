const CARD_SECTIONS = [
  { href: "#card-source", label: "原文" },
  { href: "#card-restatement", label: "我的重述" },
  { href: "#card-structured", label: "结构化卡片" },
  { href: "#card-next-action", label: "下一步行动" }
] as const;

export function CardSectionNav() {
  return (
    <nav aria-label="卡片制作分区" className="card-section-nav">
      <ol>
        {CARD_SECTIONS.map((section, index) => (
          <li key={section.href}>
            <a href={section.href}>
              <span aria-hidden="true">{index + 1}</span>
              {section.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
