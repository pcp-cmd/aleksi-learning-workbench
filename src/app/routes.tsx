import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RouteErrorBoundary } from "../components/ErrorBoundaries";
import { APP_ROUTE_REGISTRY } from "./route-registry";

export function WorkbenchRoutes() {
  return (
    <Routes>
      {APP_ROUTE_REGISTRY.map(({ Component, label, path }) => (
        <Route
          element={
            <RouteErrorBoundary routeLabel={label}>
              <Suspense
                fallback={
                  <div aria-live="polite" className="route-loading" role="status">
                    正在打开{label}…
                  </div>
                }
              >
                <Component />
              </Suspense>
            </RouteErrorBoundary>
          }
          key={path}
          path={path}
        />
      ))}
      <Route element={<Navigate replace to="/today" />} path="*" />
    </Routes>
  );
}
