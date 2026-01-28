/**
 * Lightweight Sheet (shadcn-shaped) without Radix dependency.
 * Mobile-only usage for dashboard sidebar.
 */

import * as React from "react";

import { cn } from "@/lib/utils";

type SheetContextValue = { open: boolean; setOpen: (v: boolean) => void };
const SheetContext = React.createContext<SheetContextValue | null>(null);

function useSheet() {
  const ctx = React.useContext(SheetContext);
  if (!ctx) throw new Error("Sheet components must be used within <Sheet />");
  return ctx;
}

function Sheet({ children, defaultOpen = false }: { children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return <SheetContext.Provider value={{ open, setOpen }}>{children}</SheetContext.Provider>;
}

function SheetTrigger({ children, className }: { children: React.ReactNode; className?: string }) {
  const { setOpen } = useSheet();
  return (
    <span
      className={cn("inline-flex", className)}
      onClick={() => setOpen(true)}
      role="button"
      tabIndex={0}
    >
      {children}
    </span>
  );
}

function SheetClose({ children, className }: { children: React.ReactNode; className?: string }) {
  const { setOpen } = useSheet();
  return (
    <span
      className={cn("inline-flex", className)}
      onClick={() => setOpen(false)}
      role="button"
      tabIndex={0}
    >
      {children}
    </span>
  );
}

function SheetContent({
  children,
  side = "left",
  className,
}: {
  children: React.ReactNode;
  side?: "left" | "right";
  className?: string;
}) {
  const { open, setOpen } = useSheet();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
      <div
        className={cn(
          "absolute top-0 h-full w-[320px] max-w-[90vw] bg-background text-foreground shadow-xl border-border border",
          side === "left" ? "left-0" : "right-0",
          "p-4 overflow-y-auto",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent };

