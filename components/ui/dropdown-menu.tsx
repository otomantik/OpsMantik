'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type DropdownMenuContextValue = {
  open: boolean;
  setOpen: (v: boolean) => void;
};
const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenu() {
  const ctx = React.useContext(DropdownMenuContext);
  if (!ctx) throw new Error('DropdownMenu components must be used within DropdownMenu');
  return ctx;
}

const DropdownMenu = ({ children }: { children: React.ReactNode }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block">{children}</div>
    </DropdownMenuContext.Provider>
  );
};

const DropdownMenuTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ children, className, asChild, onClick, ...props }, ref) => {
  const { open, setOpen } = useDropdownMenu();
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    setOpen(!open);
  };
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void; 'data-dropdown-trigger'?: boolean }>;
    const childRef = (child as unknown as { ref?: React.RefCallback<unknown> }).ref;
    const mergedProps = {
      'data-dropdown-trigger': true,
      ref: (r: unknown) => {
        if (typeof ref === 'function') ref(r as HTMLButtonElement);
        else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = r as HTMLButtonElement;
        childRef?.(r);
      },
      onClick: (e: React.MouseEvent) => {
        child.props.onClick?.(e);
        setOpen(!open);
      },
    };
    return React.cloneElement(child, mergedProps as React.Attributes);
  }
  return (
    <button
      ref={ref}
      type="button"
      data-dropdown-trigger
      className={cn('inline-flex cursor-pointer', className)}
      onClick={handleClick}
      aria-expanded={open}
      aria-haspopup="menu"
      {...props}
    >
      {children}
    </button>
  );
});
DropdownMenuTrigger.displayName = 'DropdownMenuTrigger';

const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { align?: 'start' | 'end'; sideOffset?: number }
>(({ className, align = 'end', sideOffset = 4, ...props }, ref) => {
  const { open, setOpen } = useDropdownMenu();
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e instanceof MouseEvent && e.target instanceof Node) {
        if (contentRef.current?.contains(e.target)) return;
        if ((e.target as Element).closest?.('[data-dropdown-trigger]')) return;
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handle);
    };
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      ref={(r) => {
        (contentRef as React.MutableRefObject<HTMLDivElement | null>).current = r;
        if (typeof ref === 'function') ref(r);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = r;
      }}
      className={cn(
        'absolute z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        align === 'end' ? 'right-0' : 'left-0',
        'mt-1',
        className
      )}
      style={{ top: '100%', marginTop: sideOffset }}
      data-state={open ? 'open' : 'closed'}
      {...props}
    />
  );
});
DropdownMenuContent.displayName = 'DropdownMenuContent';

const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }
>(({ className, inset, onClick, ...props }, ref) => {
  const { setOpen } = useDropdownMenu();
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    onClick?.(e);
    setOpen(false);
  };
  return (
    <div
      ref={ref}
      role="menuitem"
      className={cn(
        'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        inset && 'pl-8',
        className
      )}
      onClick={handleClick}
      {...props}
    />
  );
});
DropdownMenuItem.displayName = 'DropdownMenuItem';

const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('px-2 py-1.5 text-sm font-semibold', inset && 'pl-8', className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

const DropdownMenuSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('-mx-1 my-1 h-px bg-muted', className)} {...props} />
  )
);
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
};
