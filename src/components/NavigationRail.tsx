import { Link, NavLink } from "react-router-dom";
import type { PrimaryAppRoute } from "../app/route-registry";

export interface NavigationRailProps {
  onOpenSettings: () => void;
  routes: readonly PrimaryAppRoute[];
}

function routeNumber(position: number): string {
  return String(position).padStart(2, "0");
}

export function NavigationRail({
  onOpenSettings,
  routes
}: NavigationRailProps) {
  return (
    <nav aria-label="学习模块" className="navigation-rail">
      <Link
        aria-label="Aleksi Learning Workbench, back to Today"
        className="rail-brand"
        title="Aleksi Learning Workbench · Back to Today"
        to="/today"
      >
        <span className="rail-brand__mark" aria-hidden="true">A</span>
        <span className="rail-brand__text">
          <span>Aleksi</span>
          <span>Workbench</span>
        </span>
      </Link>
      <div className="rail-links">
        {routes.map((route) => (
          <NavLink
            aria-label={route.label}
            className={({ isActive }) =>
              isActive ? "rail-link is-active" : "rail-link"
            }
            key={route.path}
            to={route.path}
          >
            <span className="rail-link__mark" aria-hidden="true">
              {routeNumber(route.position)}
            </span>
            <span className="rail-link__label" aria-hidden="true">
              {route.shortLabel}
            </span>
          </NavLink>
        ))}
      </div>
      <div className="rail-utilities">
        <button
          aria-label="打开设置"
          className="rail-context-button"
          onClick={onOpenSettings}
          type="button"
        >
          设置
        </button>
      </div>
    </nav>
  );
}
