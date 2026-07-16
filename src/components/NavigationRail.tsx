import type { MouseEvent } from "react";
import { Link, NavLink } from "react-router-dom";
import type { PrimaryAppRoute } from "../app/route-registry";
import { confirmDiscardUnsavedChanges } from "../lib/unsaved-guard";
import { FlywheelBrandMark } from "./FlywheelBrandMark";

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
  const guardNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    if (!confirmDiscardUnsavedChanges()) {
      event.preventDefault();
    }
  };

  return (
    <nav aria-label="学习模块" className="navigation-rail">
      <Link
        aria-label="Aleksi Learning Workbench, back to Today"
        className="rail-brand"
        onClick={guardNavigation}
        title="Aleksi Learning Workbench · Back to Today"
        to="/today"
      >
        <span className="rail-brand__mark" aria-hidden="true">
          <FlywheelBrandMark />
        </span>
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
            onClick={guardNavigation}
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
