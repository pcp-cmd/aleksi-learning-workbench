import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Copy,
  CornerDownLeft,
  Lightbulb,
  LoaderCircle,
  RotateCcw,
  ScanLine,
  TriangleAlert,
  Workflow
} from "lucide-react";
import type { ComponentType } from "react";
import type {
  FlywheelStageKey,
  FlywheelStageView,
  LearningStatus
} from "./flywheel-state";

type FlywheelGraphProps = {
  conceptName: string;
  stages: FlywheelStageView[];
  onSelectStage: (stage: FlywheelStageKey) => void;
  selectedStage: FlywheelStageKey;
};

type IconComponent = ComponentType<{ "aria-hidden"?: true; size?: number; strokeWidth?: number }>;

const STAGE_ICONS: Record<FlywheelStageKey, IconComponent> = {
  concept: Lightbulb,
  example: Copy,
  boundary: ScanLine,
  process: Workflow,
  mistake: TriangleAlert
};

const STATUS_ICONS: Record<LearningStatus, IconComponent> = {
  established: CheckCircle2,
  learning: LoaderCircle,
  "not-started": Circle,
  "due-for-review": RotateCcw,
  verified: CheckCircle2,
  "needs-repair": TriangleAlert
};

export function FlywheelGraph({
  conceptName,
  stages,
  onSelectStage,
  selectedStage
}: FlywheelGraphProps) {
  return (
    <section className="flywheel-board" aria-label={`${conceptName} 主题飞轮`}>
      <div aria-hidden="true" className="flywheel-loop">
        <ArrowRight className="flywheel-loop__arrow flywheel-loop__arrow--top-one" size={22} strokeWidth={1.7} />
        <ArrowRight className="flywheel-loop__arrow flywheel-loop__arrow--top-two" size={22} strokeWidth={1.7} />
        <ArrowDown className="flywheel-loop__arrow flywheel-loop__arrow--right" size={22} strokeWidth={1.7} />
        <ArrowLeft className="flywheel-loop__arrow flywheel-loop__arrow--bottom" size={22} strokeWidth={1.7} />
        <CornerDownLeft className="flywheel-loop__arrow flywheel-loop__arrow--return" size={22} strokeWidth={1.7} />
      </div>
      <p className="flywheel-loop__caption">学习闭环 · 从理解到迁移</p>
      <ol className="flywheel-stage-grid">
        {stages.map((stage) => {
          const StageIcon = STAGE_ICONS[stage.key];
          const StatusIcon = STATUS_ICONS[stage.learningStatus];
          return (
            <li className={`flywheel-stage-position flywheel-stage-position--${stage.key}`} key={stage.key}>
              <button
                aria-label={`${stage.index}. ${stage.label}，覆盖${stage.coverageLabel}，${stage.learningStatusLabel}，${stage.count} 张卡片`}
                aria-pressed={selectedStage === stage.key}
                className={`flywheel-stage-card flywheel-stage-card--${stage.learningStatus}${
                  selectedStage === stage.key ? " is-selected" : ""
                }`}
                onClick={() => onSelectStage(stage.key)}
                type="button"
              >
                <span className="flywheel-stage-card__number">{stage.index}</span>
                <span className="flywheel-stage-card__icon">
                  <StageIcon aria-hidden={true} size={25} strokeWidth={1.65} />
                </span>
                <strong>{stage.label}</strong>
                <span className="flywheel-stage-card__description">{stage.description}</span>
                <span className="flywheel-stage-card__status">
                  <StatusIcon aria-hidden={true} size={15} strokeWidth={1.9} />
                  {stage.learningStatusLabel}
                </span>
                <span className="flywheel-stage-card__progress-copy">
                  <span>{stage.count} 张卡片</span>
                  <span>{stage.coverageLabel}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
