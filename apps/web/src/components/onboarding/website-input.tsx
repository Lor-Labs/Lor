import { Globe02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/ui/components/input-group"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { normalizeDomain } from "@repo/utils/domain"
import { AnimatePresence, motion } from "motion/react"
import { type ComponentProps, useEffect, useState } from "react"

const FAVICON_DEBOUNCE_MS = 300

// Google's public favicon service: resolves each site's icon and serves it as
// PNG. The desktop CSP already allows https images.
export function faviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
}

// Pops in from half size through a blur on the snap spring the mobile sheets
// use: damping ratio ~0.8, so it lands crisply with no visible bounce. Exit is
// a quicker tween, and the next icon waits for it (mode="wait").
const iconMotion = {
  initial: { opacity: 0, scale: 0.5, filter: "blur(4px)" },
  animate: {
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      scale: { type: "spring", stiffness: 420, damping: 33, mass: 1 },
      opacity: { duration: 0.15, ease: EASE_OUT },
      filter: { duration: 0.2, ease: EASE_OUT },
    },
  },
  exit: {
    opacity: 0,
    scale: 0.5,
    filter: "blur(4px)",
    transition: { duration: 0.12, ease: EASE_OUT },
  },
} as const

type WebsiteInputProps = Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "size"
> & {
  value: string
  onChange: (value: string) => void
}

// Website field that shows the site's favicon once the typed domain resolves.
// The icon swaps in only after it has loaded, so a slow or missing favicon
// never flashes a broken image.
export function WebsiteInput({ value, onChange, ...props }: WebsiteInputProps) {
  const [domain, setDomain] = useState(() => normalizeDomain(value))
  const [loadedDomain, setLoadedDomain] = useState<string | null>(null)

  useEffect(() => {
    const id = setTimeout(
      () => setDomain(normalizeDomain(value)),
      FAVICON_DEBOUNCE_MS
    )
    return () => clearTimeout(id)
  }, [value])

  const showFavicon = domain !== null && loadedDomain === domain

  return (
    <InputGroup>
      <InputGroupAddon>
        <span className="relative flex size-4 items-center justify-center">
          <AnimatePresence initial={false} mode="wait">
            {showFavicon ? (
              <motion.img
                key={domain}
                src={faviconUrl(domain)}
                alt=""
                className="size-4 rounded-[3px] object-contain"
                {...iconMotion}
              />
            ) : (
              <motion.span key="globe" className="flex" {...iconMotion}>
                <HugeiconsIcon
                  icon={Globe02Icon}
                  className="size-4 text-muted-foreground"
                  strokeWidth={1.75}
                />
              </motion.span>
            )}
          </AnimatePresence>
          {domain && loadedDomain !== domain && (
            <img
              key={domain}
              src={faviconUrl(domain)}
              alt=""
              aria-hidden
              className="sr-only"
              onLoad={() => setLoadedDomain(domain)}
            />
          )}
        </span>
      </InputGroupAddon>
      <InputGroupInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
    </InputGroup>
  )
}
