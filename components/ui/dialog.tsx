/**
 * Lightweight Dialog (shadcn-shaped) without Radix dependency.
 *
 * We intentionally avoid @radix-ui/react-dialog to keep deps minimal.
 * API matches common shadcn exports enough for internal use.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

type DialogContextValue = { open: boolean; setOpen: (v: boolean) => void };
const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialog() {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("Dialog components must be used within <Dialog />");
  return ctx;
}

function Dialog({ children, defaultOpen = false }: { children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return <DialogContext.Provider value={{ open, setOpen }}>{children}</DialogContext.Provider>;
}

function DialogTrigger({ children, className }: { children: React.ReactNode; className?: string }) {
  const { setOpen } = useDialog();
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

function DialogClose({ children, className }: { children: React.ReactNode; className?: string }) {
  const { setOpen } = useDialog();
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

function DialogContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { open, setOpen } = useDialog();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
      <div
        className={cn(
          "absolute left-1/2 top-1/2 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2",
          "rounded-lg border border-border bg-background text-foreground shadow-xl",
          "p-4 md:p-6",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5", className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-end gap-2", className)} {...props} />;
}

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
};

