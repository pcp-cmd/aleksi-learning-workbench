import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StatusDot } from "../../components/StatusDot";
import { apiClient } from "../../lib/api-client";
import { FlywheelGraph } from "./FlywheelGraph";
import {
  deriveFlywheelStages,
  flywheelCoverage,
  primaryFlywheelStage,
  type FlywheelStageKey,
  type FlywheelStageView,
  type GraphConceptState
} from "./flywheel-state";
import { writeGraphWorkTransfer } from "../reader/reader-selection-transfer";

type GraphStateDocument = {
  generatedAt: string;
  concepts: Record<string, GraphConceptState>;
};

const CARD_LABELS: Record<FlywheelStageKey, string> = {
  concept: "概念卡",
  example: "例子卡",
  boundary: "边界卡",
  process: "流程卡",
  mistake: "错误卡"
};

function sortConcepts(concepts: Record<string, GraphConceptState>): GraphConceptState[] {
  return Object.values(concepts).sort((left, right) =>
    left.concept < right.concept ? -1 : left.concept > right.concept ? 1 : 0
  );
}

function ConceptDetail({
  concept,
  onStartWork,
  selectedStage
}: {
  concept: GraphConceptState;
  onStartWork: () => void;
  selectedStage: FlywheelStageView;
}) {
  return (
    <aside
      aria-label="概念详情"
      className="surface-static graph-detail-panel"
      role="complementary"
    >
      <StatusDot
        label={`${selectedStage.index}. ${selectedStage.label} · ${selectedStage.learningStatusLabel}`}
        tone={
          selectedStage.learningStatus === "verified" ||
          selectedStage.learningStatus === "established"
            ? "active"
            : selectedStage.learningStatus === "needs-repair"
              ? "blocked"
              : "due"
        }
      />
      <h2>{selectedStage.label}</h2>
      <p>{selectedStage.description}</p>
      <dl className="graph-stage-facts">
        <div><dt>当前材料</dt><dd>{selectedStage.count} 张{CARD_LABELS[selectedStage.key]}</dd></div>
        <div><dt>结构覆盖</dt><dd>{selectedStage.coverageLabel}</dd></div>
        <div><dt>学习状态</dt><dd>{selectedStage.learningStatusLabel}</dd></div>
        <div><dt>证据置信</dt><dd>{selectedStage.evidenceConfidenceLabel}</dd></div>
        <div><dt>当前卡点</dt><dd>{concept.currentBlock ?? "暂无"}</dd></div>
      </dl>
      <div className="graph-next-action">
        <span>建议下一步</span>
        <strong>{concept.nextAction}</strong>
        <button className="button" onClick={onStartWork} type="button">
          {selectedStage.learningStatus === "due-for-review"
            ? "开始这个概念的复习"
            : `在 Reader 补${selectedStage.label}卡`}
        </button>
      </div>
      <details className="graph-support-details">
        <summary>查看缺口与关联</summary>
        <h3>缺口板</h3>
        <ul aria-label="缺口标签" className="graph-gap-tags">
          {concept.suggestedNextActions.map((action) => <li className="graph-gap-tag" key={action}>{action}</li>)}
        </ul>
        <h3>相关概念</h3>
        <p>{concept.relatedConcepts.length === 0 ? "暂无相关概念" : concept.relatedConcepts.join("、")}</p>
      </details>
    </aside>
  );
}

export function WheelGraphPage() {
  const navigate = useNavigate();
  const graphState = useQuery({
    queryKey: ["graph-state"],
    queryFn: () => apiClient.get<GraphStateDocument>("/api/graph/state")
  });
  const concepts = useMemo(
    () => sortConcepts(graphState.data?.concepts ?? {}),
    [graphState.data?.concepts]
  );
  const [selectedConceptName, setSelectedConceptName] = useState<string | null>(null);
  const selectedConcept = concepts.find((concept) => concept.concept === selectedConceptName) ?? concepts[0] ?? null;
  const stages = useMemo(() => selectedConcept === null ? [] : deriveFlywheelStages(selectedConcept), [selectedConcept]);
  const [selectedStageKey, setSelectedStageKey] = useState<FlywheelStageKey>("concept");

  useEffect(() => {
    if (selectedConcept !== null) {
      setSelectedConceptName(selectedConcept.concept);
      setSelectedStageKey(primaryFlywheelStage(deriveFlywheelStages(selectedConcept)));
    }
  }, [selectedConcept?.concept]);

  const selectedStage = stages.find((stage) => stage.key === selectedStageKey) ?? stages[0] ?? null;
  const coverage = flywheelCoverage(stages);

  const startSelectedWork = () => {
    if (selectedConcept === null || selectedStage === null) return;
    if (selectedStage.learningStatus === "due-for-review") {
      navigate(`/review?concept=${encodeURIComponent(selectedConcept.concept)}`);
      return;
    }

    writeGraphWorkTransfer({
      source: "graph-action",
      target: "reader",
      concept: selectedConcept.concept,
      stage: selectedStage.key,
      cardType: selectedStage.key
    });
    navigate(
      `/reader?concept=${encodeURIComponent(selectedConcept.concept)}&stage=${selectedStage.key}`
    );
  };

  return (
    <section className="route-stage graph-page" aria-labelledby="graph-title">
      <p className="eyebrow">Knowledge Flywheel</p>
      <h1 id="graph-title">主题飞轮</h1>
      <p className="route-stage__summary">
        围绕一个主题依次建立概念、例子、边界、流程与错误，再把发现带回下一轮理解。
      </p>
      {graphState.isPending ? (
        <div className="surface-static route-stage__card">
          <StatusDot label="读取图谱" />
          <p>正在读取本地飞轮图谱缓存。</p>
        </div>
      ) : concepts.length === 0 ? (
        <div className="surface-static route-stage__card">
          <StatusDot label="等待概念" />
          <p>还没有可显示的概念。先从阅读摘录生成第一张卡片。</p>
        </div>
      ) : (
        <>
          <div className="graph-toolbar" aria-label="选择学习概念">
            <div className="graph-concept-tabs" role="list">
              {concepts.map((concept) => (
                <button
                  aria-pressed={selectedConcept?.concept === concept.concept}
                  className="graph-concept-tab"
                  key={concept.concept}
                  onClick={() => setSelectedConceptName(concept.concept)}
                  type="button"
                >
                  {concept.concept}
                </button>
              ))}
            </div>
            <span className="graph-mastery-summary">
              覆盖：<strong>{coverage.established} / {coverage.total}</strong> 个维度已建立
              {coverage.needsRepair === 0 ? null : ` · ${coverage.needsRepair} 个需修复`}
            </span>
          </div>
          <div className="graph-layout">
          <div className="graph-overview">
            <StatusDot label={`${selectedConcept?.concept ?? ""} · 五段闭环`} tone="active" />
            <FlywheelGraph
              conceptName={selectedConcept?.concept ?? ""}
              onSelectStage={setSelectedStageKey}
              selectedStage={selectedStageKey}
              stages={stages}
            />
          </div>
          {selectedConcept === null || selectedStage === null ? null : (
            <ConceptDetail
              concept={selectedConcept}
              onStartWork={startSelectedWork}
              selectedStage={selectedStage}
            />
          )}
          </div>
        </>
      )}
    </section>
  );
}

export { FLYWHEEL_STAGE_ORDER } from "./flywheel-state";
