import type { Dispatch, RefObject, SetStateAction } from "react";
import { CARD_LABELS } from "../../../shared/card-labels";
import { PRIMARY_CARD_TYPES, type PrimaryCardType } from "../../../shared/card-types";
import type { BlockType } from "../cards/card-draft";
import {
  ASSISTANCE_OPTIONS,
  BLOCK_TYPES,
  CONFIDENCE_OPTIONS,
  FEEDBACKS,
  type ReviewAssistanceLevel,
  type ReviewConfidence,
  type ReviewFeedback,
  type ReviewUiState
} from "./review-contract";

export function ReviewAttemptStep(props: {
  answer: string;
  assistanceLevel: ReviewAssistanceLevel;
  attemptLocked: boolean;
  canSaveAttempt: boolean;
  confidence: ReviewConfidence | null;
  declaredDontKnow: boolean;
  onSave: () => void;
  setAnswer: Dispatch<SetStateAction<string>>;
  setAssistanceLevel: Dispatch<SetStateAction<ReviewAssistanceLevel>>;
  setConfidence: Dispatch<SetStateAction<ReviewConfidence | null>>;
  setDeclaredDontKnow: Dispatch<SetStateAction<boolean>>;
  uiState: ReviewUiState;
}) {
  return (
    <section className="review-attempt" aria-labelledby="review-attempt-title">
      <div className="review-section-heading"><span>01</span><div>
        <h3 id="review-attempt-title">留下独立作答</h3>
        <p>不要润色成标准答案，保留此刻真实会写出的内容。</p>
      </div></div>
      <label className="review-text-field">我的闭卷回答
        <textarea disabled={props.declaredDontKnow || props.attemptLocked}
          onChange={(event) => props.setAnswer(event.target.value)} rows={6} value={props.answer} />
      </label>
      <label className="review-dont-know"><input checked={props.declaredDontKnow}
        disabled={props.attemptLocked} onChange={(event) => {
          props.setDeclaredDontKnow(event.target.checked);
          if (event.target.checked) props.setAnswer("");
        }} type="checkbox" /><span>我现在确实不知道</span></label>
      <fieldset className="review-choice-fieldset"><legend>揭示前的信心</legend>
        <div className="review-choice-grid review-choice-grid--confidence">
          {CONFIDENCE_OPTIONS.map((option) => <label className="review-choice" key={option.value}>
            <input checked={props.confidence === option.value} disabled={props.attemptLocked}
              name="review-confidence" onChange={() => props.setConfidence(option.value)}
              type="radio" value={option.value} /><span>{option.label}</span>
          </label>)}
        </div>
      </fieldset>
      <fieldset className="review-choice-fieldset"><legend>本次是否使用辅助</legend>
        <div className="review-choice-grid">{ASSISTANCE_OPTIONS.map((option) =>
          <label className="review-choice" key={option.value}><input
            checked={props.assistanceLevel === option.value} disabled={props.attemptLocked}
            name="review-assistance" onChange={() => props.setAssistanceLevel(option.value)}
            type="radio" value={option.value} /><span>{option.label}</span></label>)}</div>
      </fieldset>
      <button className="button review-primary-button"
        disabled={!props.canSaveAttempt || props.uiState === "saving-attempt"}
        onClick={props.onSave} type="button">
        {props.uiState === "saving-attempt" ? "正在保存尝试" : "保存尝试并揭示答案"}
      </button>
    </section>
  );
}

export function ReviewResultStep(props: {
  assumedProblem: string;
  blockType: BlockType | "";
  causeHypothesis: string;
  feedback: ReviewFeedback | null;
  nextMinimumAction: string;
  onSubmit: () => void;
  resultLocked: boolean;
  resultRef: RefObject<HTMLElement | null>;
  selfCorrection: string;
  setAssumedProblem: Dispatch<SetStateAction<string>>;
  setBlockType: Dispatch<SetStateAction<BlockType | "">>;
  setCauseHypothesis: Dispatch<SetStateAction<string>>;
  setFeedback: Dispatch<SetStateAction<ReviewFeedback | null>>;
  setNextMinimumAction: Dispatch<SetStateAction<string>>;
  setSelfCorrection: Dispatch<SetStateAction<string>>;
  setTargetCardType: Dispatch<SetStateAction<PrimaryCardType>>;
  targetCardType: PrimaryCardType;
  uiState: ReviewUiState;
  weakFeedback: boolean;
}) {
  return (
    <section aria-labelledby="review-result-title" className="review-result"
      ref={props.resultRef} tabIndex={-1}>
      <div className="review-section-heading"><span>02</span><div>
        <h3 id="review-result-title">比较后记录结果</h3>
        <p>弱结果会保留卡点草稿；一次自评不会直接产生“已掌握”。</p>
      </div></div>
      <fieldset className="review-choice-fieldset review-feedbacks"><legend>这次独立回忆的结果</legend>
        <div className="review-choice-grid review-choice-grid--feedback">{FEEDBACKS.map((option) =>
          <label className="review-choice" key={option.value}><input
            checked={props.feedback === option.value} disabled={props.resultLocked}
            name="review-feedback" onChange={() => props.setFeedback(option.value)}
            type="radio" value={option.value} /><span>{option.label}</span></label>)}</div>
      </fieldset>
      {props.feedback === null ? null : <div className="review-submit-panel">
        <label className="review-select-field">本次卡点<select disabled={props.resultLocked}
          onChange={(event) => props.setBlockType(event.target.value as BlockType | "")}
          value={props.blockType}><option value="">请选择</option>{BLOCK_TYPES.map((option) =>
            <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="review-text-field">揭示后的自我修正{props.weakFeedback ? "（必填）" : "（可选）"}
          <textarea disabled={props.resultLocked} onChange={(event) => props.setSelfCorrection(event.target.value)}
            rows={3} value={props.selfCorrection} /></label>
        {props.weakFeedback ? <fieldset className="review-diagnosis"><legend>卡点诊断草稿 · 尚未保存</legend>
          <p>这些内容随复习证据保存，但不会自动创建或关闭卡点诊断。提交后由你显式进入诊断页确认。</p>
          <label className="review-text-field">我原先以为的问题<textarea disabled={props.resultLocked}
            onChange={(event) => props.setAssumedProblem(event.target.value)} rows={2} value={props.assumedProblem} /></label>
          <label className="review-text-field">当前原因假设（待复测）<textarea disabled={props.resultLocked}
            onChange={(event) => props.setCauseHypothesis(event.target.value)} rows={3} value={props.causeHypothesis} /></label>
          <label className="review-text-field">下一步最小行动<textarea disabled={props.resultLocked}
            onChange={(event) => props.setNextMinimumAction(event.target.value)} rows={3} value={props.nextMinimumAction} /></label>
          <label className="review-select-field">补救后沉淀为<select disabled={props.resultLocked}
            onChange={(event) => props.setTargetCardType(event.target.value as PrimaryCardType)}
            value={props.targetCardType}>{PRIMARY_CARD_TYPES.map((type) =>
              <option key={type} value={type}>{CARD_LABELS[type].label}</option>)}</select></label>
        </fieldset> : null}
        <button className="button review-primary-button" disabled={props.uiState === "saving-result"}
          onClick={props.onSubmit} type="button">
          {props.uiState === "saving-result" ? "正在保存结果" : "保存复习结果"}
        </button>
      </div>}
    </section>
  );
}
