/**
 * Lightweight Tooltip (shadcn-shaped) without Radix dependency.
 *
 * This keeps shadcn-style API (Tooltip/Trigger/Content) while avoiding
 * adding new Radix deps in constrained environments.
 */

import * as React from "react";

import { cn } from "@/lib/utils";

const TooltipProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;

function Tooltip({ children }: { children: React.ReactNode }) {
  return <span className="relative inline-flex group">{children}</span>;
}

function TooltipTrigger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn("inline-flex", className)}>{children}</span>;
}

function TooltipContent({
  children,
  className,
  sideOffset,
}: {
  children: React.ReactNode;
  className?: string;
  sideOffset?: number;
}) {
  const mt = typeof sideOffset === "number" ? `mt-[${sideOffset}px]` : "mt-2";
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-0 top-full z-50 hidden w-max max-w-[320px] rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md group-hover:block",
        mt,
        className
      )}
    >
      {children}
    </span>
  );
}

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };

