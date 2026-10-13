"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { Button, type ButtonProps } from "@repo/ui/components/button"
import { cn } from "@repo/ui/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"

// One file as a bordered row: type icon, name and a muted detail line. A
// FileChipTrigger covers the whole chip; FileChipActions sit above it.
const fileChipVariants = cva(
  "group/file-chip relative flex w-fit min-w-40 max-w-full shrink-0 items-center rounded-xl border bg-card text-card-foreground transition-colors duration-150 ease-out has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[>a,>button]:hover:bg-accent/60",
  {
    variants: {
      size: {
        default: "gap-2.5 px-2.5 py-2 text-sm",
        sm: "gap-2 px-2 py-1.5 text-xs",
      },
    },
    defaultVariants: { size: "default" },
  }
)

function FileChip({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fileChipVariants>) {
  return (
    <div
      data-slot="file-chip"
      data-size={size}
      className={cn(fileChipVariants({ size }), className)}
      {...props}
    />
  )
}

const fileChipMediaVariants = cva(
  "relative flex size-8 shrink-0 items-center justify-center overflow-hidden group-data-[size=sm]/file-chip:size-7 [&>svg]:size-full",
  {
    variants: {
      variant: {
        icon: "",
        image: "rounded-md bg-muted *:[img]:size-full *:[img]:object-cover",
      },
    },
    defaultVariants: { variant: "icon" },
  }
)

function FileChipMedia({
  className,
  variant = "icon",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fileChipMediaVariants>) {
  return (
    <div
      data-slot="file-chip-media"
      className={cn(fileChipMediaVariants({ variant }), className)}
      {...props}
    />
  )
}

function FileChipContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="file-chip-content"
      className={cn("min-w-0 flex-1 leading-tight", className)}
      {...props}
    />
  )
}

function FileChipTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="file-chip-title"
      className={cn("block min-w-0 truncate font-medium", className)}
      {...props}
    />
  )
}

function FileChipDescription({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="file-chip-description"
      className={cn(
        "mt-0.5 block min-w-0 truncate text-muted-foreground text-xs tabular-nums group-data-[size=sm]/file-chip:text-[11px]",
        className
      )}
      {...props}
    />
  )
}

function FileChipActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="file-chip-actions"
      className={cn("relative z-20 flex shrink-0 items-center", className)}
      {...props}
    />
  )
}

function FileChipAction({
  variant = "ghost",
  size = "icon-xs",
  ...props
}: ButtonProps) {
  return (
    <Button
      data-slot="file-chip-action"
      variant={variant}
      size={size}
      {...props}
    />
  )
}

// Renders a <button> by default; pass `render={<a href=… />}` for a link.
function FileChipTrigger({
  className,
  render,
  ...props
}: useRender.ComponentProps<"button">) {
  const type: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button"
  const defaultProps = {
    "data-slot": "file-chip-trigger",
    type,
    className: cn(
      "absolute inset-0 z-10 cursor-pointer rounded-[inherit] outline-none disabled:cursor-default",
      className
    ),
  }
  return useRender({
    defaultTagName: "button",
    render,
    props: mergeProps<"button">(defaultProps, props),
  })
}

export {
  FileChip,
  FileChipAction,
  FileChipActions,
  FileChipContent,
  FileChipDescription,
  FileChipMedia,
  FileChipTitle,
  FileChipTrigger,
}
