import { Navigate, Route, Routes } from "react-router-dom";
import { APP_ROUTE_REGISTRY } from "./route-registry";

export function WorkbenchRoutes() {
  return (
    <Routes>
      {APP_ROUTE_REGISTRY.map(({ Component, path }) => (
        <Route element={<Component />} key={path} path={path} />
      ))}
      <Route element={<Navigate replace to="/today" />} path="*" />
    </Routes>
  );
}
