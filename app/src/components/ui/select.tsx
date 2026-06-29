import * as React from "react"
import { cn } from "@/lib/utils"

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          "flex h-11 w-full rounded-[--radius] border border-input-border bg-input px-3.5 py-2 text-[15px] text-foreground transition-[border-color,box-shadow] duration-150 ease-out hover:border-input-border focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
    )
  }
)
Select.displayName = "Select"

export { Select }
