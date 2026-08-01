import { createContext, useContext } from "react";

const SettingsContext = createContext<() => void>(() => undefined);

export const SettingsProvider = SettingsContext.Provider;

export function useOpenSettings(): () => void {
  return useContext(SettingsContext);
}
