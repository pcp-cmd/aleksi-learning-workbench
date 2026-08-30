import {
  lazy,
  type ComponentType,
  type LazyExoticComponent
} from "react";
import { TodayPage } from "../features/today/TodayPage";

type RouteComponent = ComponentType | LazyExoticComponent<ComponentType>;

type LazyRoute = {
  readonly Component: RouteComponent;
  readonly preload: () => Promise<void>;
};

function createLazyRoute<TModule>(
  importer: () => Promise<TModule>,
  exportName: keyof TModule
): LazyRoute {
  let loaded: Promise<{ default: ComponentType }> | null = null;
  const load = () => {
    if (loaded === null) {
      loaded = importer()
        .then((module) => {
          const Component = module[exportName];
          if (typeof Component !== "function") {
            throw new Error(`Route export ${String(exportName)} is not a component`);
          }
          return { default: Component as ComponentType };
        })
        .catch((error: unknown) => {
          loaded = null;
          throw error;
        });
    }
    return loaded;
  };

  return {
    Component: lazy(load),
    preload: async () => {
      await load();
    }
  };
}

const todayRoute: LazyRoute = {
  Component: TodayPage,
  preload: async () => undefined
};
const readerRoute = createLazyRoute(
  () => import("../features/reader/ReaderPage"),
  "ReaderPage"
);
const cardsRoute = createLazyRoute(
  () => import("../features/cards/CardStudioPage"),
  "CardStudioPage"
);
const graphRoute = createLazyRoute(
  () => import("../features/graph/WheelGraphPage"),
  "WheelGraphPage"
);
const reviewRoute = createLazyRoute(
  () => import("../features/review/ReviewPage"),
  "ReviewPage"
);
const diagnosisRoute = createLazyRoute(
  () => import("../features/diagnosis/DiagnosisPage"),
  "DiagnosisPage"
);
const verificationRoute = createLazyRoute(
  () => import("../features/verification/VerificationPage"),
  "VerificationPage"
);

export type RouteVisibility = "primary" | "contextual" | "advanced";

export interface AppRoute {
  readonly Component: RouteComponent;
  readonly description: string;
  readonly label: string;
  readonly path: string;
  readonly preload: () => Promise<void>;
  readonly position?: number;
  readonly shortLabel: string;
  readonly status: string;
  readonly title: string;
  readonly visibility: RouteVisibility;
}

export type PrimaryAppRoute = AppRoute & {
  readonly position: number;
  readonly visibility: "primary";
};

export const APP_ROUTE_REGISTRY: readonly AppRoute[] = [
  {
    ...todayRoute,
    path: "/today",
    label: "今日学习",
    shortLabel: "今日",
    title: "今日学习",
    position: 1,
    visibility: "primary",
    description: "聚合今天要读、要补、要复习的最小行动。",
    status: "等待本地学习库数据"
  },
  {
    ...readerRoute,
    path: "/reader",
    label: "精读工作台",
    shortLabel: "精读",
    title: "精读工作台",
    position: 2,
    visibility: "primary",
    description: "阅读优先的响应式精读纸面，承接材料、临时摘录篮与整理动作。",
    status: "阅读优先"
  },
  {
    ...cardsRoute,
    path: "/cards",
    label: "卡片工作台",
    shortLabel: "卡片",
    title: "卡片工作台",
    position: 3,
    visibility: "primary",
    description: "创建、更新、归档概念、例子、边界、流程与错误卡。",
    status: "五类卡片"
  },
  {
    ...graphRoute,
    path: "/graph",
    label: "主题飞轮",
    shortLabel: "飞轮",
    title: "主题飞轮",
    position: 4,
    visibility: "primary",
    description: "围绕概念、例子、边界、流程与错误推进完整学习闭环。",
    status: "五维学习闭环"
  },
  {
    ...reviewRoute,
    path: "/review",
    label: "今日复习",
    shortLabel: "复习",
    title: "今日复习",
    position: 5,
    visibility: "primary",
    description: "按今天到期的卡片推进掌握度与下一次复习。",
    status: "调度中"
  },
  {
    ...diagnosisRoute,
    path: "/diagnosis",
    label: "学习诊断",
    shortLabel: "诊断",
    title: "学习诊断",
    visibility: "contextual",
    description: "从当前材料或卡片进入的针对性诊断。",
    status: "上下文工具"
  },
  {
    ...verificationRoute,
    path: "/verification",
    label: "证据验证",
    shortLabel: "验证",
    title: "证据验证",
    visibility: "advanced",
    description: "审阅学习证据及其可追溯关系。",
    status: "高级工具"
  }
];

export const PRIMARY_ROUTES: readonly PrimaryAppRoute[] =
  APP_ROUTE_REGISTRY.filter(
    (route): route is PrimaryAppRoute =>
      route.visibility === "primary" && route.position !== undefined
  ).sort((left, right) => left.position - right.position);
