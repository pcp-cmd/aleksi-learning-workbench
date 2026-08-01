import { StatusDot, type StatusDotTone } from "./StatusDot";

export interface ActionBandItem {
  label: string;
  value: string;
  tone?: StatusDotTone;
}

const DEFAULT_ITEMS: ActionBandItem[] = [
  {
    label: "材料选择",
    value: "等待选择真实材料",
    tone: "idle"
  },
  {
    label: "卡点状态",
    value: "等待诊断结果",
    tone: "idle"
  },
  {
    label: "建议入口",
    value: "进入今日学习后生成",
    tone: "active"
  }
];

export function ActionBand({ items = DEFAULT_ITEMS }: { items?: ActionBandItem[] }) {
  return (
    <section className="action-band" aria-label="上下文状态" tabIndex={0}>
      <ol className="action-band__list">
        {items.map((item, index) => (
          <li
            className={`action-band__cell${
              index === items.length - 1 ? " action-band__cell--primary" : ""
            }`}
            key={item.label}
          >
            <StatusDot label={item.label} tone={item.tone} />
            <strong>{item.value}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}
