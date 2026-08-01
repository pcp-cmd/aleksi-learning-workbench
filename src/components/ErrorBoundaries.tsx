import { Component, type ErrorInfo, type ReactNode } from "react";

type BoundaryProps = {
  children: ReactNode;
};

type RouteBoundaryProps = BoundaryProps & {
  routeLabel: string;
};

type BoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Aleksi Workbench root render failed", error, info.componentStack);
  }

  render() {
    if (this.state.error === null) {
      return this.props.children;
    }

    return (
      <main className="fatal-error" role="alert">
        <p className="eyebrow">Recovery</p>
        <h1>工作台暂时无法显示</h1>
        <p>你的本地学习库和草稿没有被删除。请重新加载应用后继续。</p>
        <button className="button" onClick={() => window.location.reload()} type="button">
          重新加载应用
        </button>
      </main>
    );
  }
}

export class RouteErrorBoundary extends Component<
  RouteBoundaryProps,
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `Aleksi Workbench route failed: ${this.props.routeLabel}`,
      error,
      info.componentStack
    );
  }

  render() {
    if (this.state.error === null) {
      return this.props.children;
    }

    return (
      <section className="route-stage route-error" role="alert">
        <p className="eyebrow">Recovery</p>
        <h1>{this.props.routeLabel}暂时无法显示</h1>
        <p>其他学习页面仍可使用，本地草稿也会保留。</p>
        <div className="form-actions">
          <button
            className="button"
            onClick={() => this.setState({ error: null })}
            type="button"
          >
            重试此页面
          </button>
          <a className="button button-ghost" href="/today">
            返回今日学习
          </a>
        </div>
      </section>
    );
  }
}
