export interface SaveReceiptProps {
  at: string | null;
  label?: string;
  path: string | null;
}

export function SaveReceipt({
  at,
  label = "最近保存",
  path
}: SaveReceiptProps) {
  return (
    <dl className="save-receipt">
      <div>
        <dt>{label}</dt>
        <dd>{path ?? "尚无保存路径"}</dd>
      </div>
      <div>
        <dt>保存时间</dt>
        <dd>{at ?? "尚无保存记录"}</dd>
      </div>
    </dl>
  );
}
