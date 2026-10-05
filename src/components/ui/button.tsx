import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

/**
 * Variants are defined once here, never inline in a view. §9.1
 * `transition-state` uses the single 150ms state-change token.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium select-none transition-state outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:brightness-110 active:brightness-95",
        surface:
          "bg-surface-raised text-foreground border border-border hover:border-border-strong",
        ghost: "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
        /** Emergency stop. Deliberately the loudest control in the app. §4.7 */
        danger:
          "bg-critical text-white shadow-lg shadow-critical/25 hover:brightness-110 active:brightness-95",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        xl: "h-16 px-8 text-lg font-semibold",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "surface", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
