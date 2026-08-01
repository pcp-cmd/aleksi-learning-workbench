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
              <Component />
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
