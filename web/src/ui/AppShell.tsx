import { useLayoutEffect, type MouseEvent, type ReactNode } from "react";
import type { FontScale, Theme } from "../types";
import { IconRotate } from "./icons";

export interface AppShellProps {
  theme: Theme;
  fontScale: FontScale;
  /** True while either speaker is recording: draws the thick red frame around the whole screen. */
  recording: boolean;
  children: ReactNode;
}

/** Elements whose native long-press menu must keep working (text editing, links). */
const NATIVE_MENU_OK = "input, textarea, select, a[href]";

/**
 * Root wrapper: 100dvh column, max-width 430px centered, safe-area padding,
 * theme + font-scale attributes, recording frame and the landscape guard.
 */
export function AppShell({ theme, fontScale, recording, children }: AppShellProps) {
  // Mirror the attributes on <html> so the body background and overscroll areas follow the theme.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.fontScale = String(fontScale);
  }, [theme, fontScale]);

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    if (!(e.target as Element).closest(NATIVE_MENU_OK)) e.preventDefault();
  };

  return (
    <div
      className="app-shell"
      data-theme={theme}
      data-font-scale={fontScale}
      data-recording={recording || undefined}
      onContextMenu={onContextMenu}
    >
      {children}
      <div className="landscape-guard" role="status">
        <IconRotate className="landscape-guard__icon" />
        세로 모드로 사용해 주세요
      </div>
    </div>
  );
}
