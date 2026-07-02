import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Spinner } from "./spinner"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[--radius] text-[15px] font-medium select-none transition-[transform,background-color,box-shadow,color,opacity] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:brightness-110",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:brightness-110",
        warning: "bg-warning text-warning-foreground shadow-sm hover:brightness-110",
        success: "bg-success text-success-foreground shadow-sm hover:brightness-110",
        secondary: "border border-border bg-secondary text-secondary-foreground shadow-[var(--shadow-card)] hover:bg-muted",
        tinted: "bg-accent text-accent-foreground hover:brightness-95",
        outline: "border border-input-border bg-card text-foreground hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 py-2",
        sm: "h-9 rounded-[--radius-sm] px-3.5 text-[13px]",
        lg: "h-[52px] rounded-[--radius-md] px-7 text-[17px]",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Shows the brand spinner in place of the leading icon/label and disables the button. */
  loading?: boolean
  /** Text shown while loading, e.g. "Sending…" — falls back to children if omitted. */
  loadingText?: React.ReactNode
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, loadingText, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    // asChild hands its single child off to Slot for prop-cloning, so a second
    // spinner child would break it — the loading treatment only applies to
    // real buttons, which covers every current use of `loading`.
    if (asChild) {
      return (
        <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} disabled={disabled} {...props}>
          {children}
        </Comp>
      )
    }
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Spinner size="sm" tone="current" />}
        {loading ? (loadingText ?? children) : children}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
