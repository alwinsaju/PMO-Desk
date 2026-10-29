"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";

interface Props {
  appId: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Keeps one app's render crash inside its own window. Without it a thrown error
 * in any app (PMO, Staff, Tasks...) unmounts the whole desktop. "Reload app"
 * remounts the children, which re-runs their own loading from the server.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[app:${this.props.appId}] render failed:`, error, info.componentStack);
  }

  private reload = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <span
          aria-hidden
          className="bg-accent-soft text-accent-ink rounded-control grid h-11 w-11 place-items-center"
        >
          <WarningCircleIcon size={22} weight="duotone" />
        </span>
        <p className="text-ink text-sm font-semibold">This app ran into a problem</p>
        <p className="text-ink-soft max-w-xs text-[13px] leading-5">
          Your data is safe. The other windows are not affected.
        </p>
        <Button size="sm" variant="outline" onClick={this.reload}>
          Reload app
        </Button>
      </div>
    );
  }
}
