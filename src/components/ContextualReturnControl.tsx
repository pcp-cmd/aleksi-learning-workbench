import { useLayoutEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  createRouteReturnContext,
  readNavigationReturnContext,
  returnControlLabel,
  stateForReadingRestore,
  type NavigationReturnContext,
  type RouteReturnSource
} from "../app/navigation-return";
import { permitDraftPreservedNavigation } from "../lib/unsaved-guard";

type ContextualReturnControlProps = {
  fallback?: Readonly<{
    source: RouteReturnSource;
    to: string;
  }>;
  onPrepareReturn?: () => boolean;
};

export function useNavigationReturnContext(): NavigationReturnContext | null {
  const location = useLocation();
  return readNavigationReturnContext(location.state);
}

export function ContextualReturnControl({
  fallback,
  onPrepareReturn
}: ContextualReturnControlProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const inherited = readNavigationReturnContext(location.state);
  const context =
    inherited ??
    (fallback === undefined
      ? null
      : createRouteReturnContext(fallback.source, fallback.to));

  useLayoutEffect(() => {
    if (context !== null && window.scrollY !== 0) {
      window.scrollTo({ behavior: "auto", left: window.scrollX, top: 0 });
    }
  }, [context !== null, location.key]);

  if (context === null) return null;
  const label = returnControlLabel(context);

  return (
    <button
      aria-label={label}
      className="contextual-return-control"
      onClick={() => {
        if (onPrepareReturn !== undefined) {
          if (!onPrepareReturn()) return;
          permitDraftPreservedNavigation(context.returnTo);
        }
        navigate(context.returnTo, {
          state:
            context.source === "reading"
              ? stateForReadingRestore(context)
              : undefined
        });
      }}
      type="button"
    >
      {label}
    </button>
  );
}
