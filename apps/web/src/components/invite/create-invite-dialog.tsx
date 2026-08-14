import { Copy01Icon, Link01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { anchoredToastManager, toast } from "@repo/ui/components/toast"
import { useMutation } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { apiClient } from "@/lib/api-client"
import { getInviteUrl } from "@/lib/invite-url"

const EXPIRY_OPTIONS = [
  { label: "30 minutes", value: "30" },
  { label: "1 hour", value: "60" },
  { label: "6 hours", value: "360" },
  { label: "12 hours", value: "720" },
  { label: "1 day", value: "1440" },
  { label: "7 days", value: "10080" },
  { label: "Never", value: "never" },
]

const MAX_USES_OPTIONS = [
  { label: "No limit", value: "none" },
  { label: "1 use", value: "1" },
  { label: "5 uses", value: "5" },
  { label: "10 uses", value: "10" },
  { label: "25 uses", value: "25" },
  { label: "50 uses", value: "50" },
  { label: "100 uses", value: "100" },
]

export function CreateInviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const [expiresIn, setExpiresIn] = useState("1440")
  const [maxUses, setMaxUses] = useState("none")
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copyButtonRef = useRef<HTMLButtonElement>(null)

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceSlug) throw new Error("Missing workspace slug")

      const res = await apiClient.v1.workspaces[":workspaceSlug"].invites.$post(
        {
          param: { workspaceSlug },
          json: {
            expiresInMinutes: expiresIn === "never" ? null : Number(expiresIn),
            maxUses: maxUses === "none" ? null : Number(maxUses),
          },
        }
      )

      if (!res.ok) {
        const body = await res.text()
        let message = "Failed to create invite"
        try {
          const parsed = JSON.parse(body) as { message?: string }
          if (typeof parsed.message === "string") message = parsed.message
        } catch {
          // use default message
        }
        throw new Error(message)
      }

      return res.json()
    },
    onSuccess: (data) => {
      setInviteCode(data.invite.code)
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to create invite"
      )
    },
  })

  async function handleCopy() {
    if (!inviteCode) return
    try {
      await navigator.clipboard.writeText(getInviteUrl(inviteCode))
      setCopied(true)
      if (copyButtonRef.current) {
        anchoredToastManager.add({
          data: { tooltipStyle: true },
          id: "copy-created-invite-link",
          positionerProps: { anchor: copyButtonRef.current, sideOffset: 6 },
          timeout: 1800,
          title: "Invite link copied",
        })
      }
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy to clipboard")
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      // Reset state when closing
      setInviteCode(null)
      setCopied(false)
      setExpiresIn("1440")
      setMaxUses("none")
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Invite Link</DialogTitle>
          <DialogDescription>
            Generate a shareable link to invite people to this workspace.
          </DialogDescription>
        </DialogHeader>

        {inviteCode ? (
          <>
            <DialogPanel className="space-y-4">
              <div className="space-y-2">
                <Label>Invite Link</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={getInviteUrl(inviteCode)}
                    className="font-mono text-sm"
                  />
                  <Button
                    ref={copyButtonRef}
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={copied ? "Copied link" : "Copy link"}
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        className="size-4"
                        strokeWidth={2}
                      />
                    ) : (
                      <HugeiconsIcon
                        icon={Copy01Icon}
                        className="size-4"
                        strokeWidth={2}
                      />
                    )}
                  </Button>
                </div>
              </div>
            </DialogPanel>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
              >
                Done
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setInviteCode(null)
                  setCopied(false)
                }}
              >
                Create Another
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogPanel className="space-y-4">
              <div className="space-y-2">
                <Label>Expire After</Label>
                <Select
                  items={EXPIRY_OPTIONS}
                  value={expiresIn}
                  onValueChange={(v) => v && setExpiresIn(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Max Uses</Label>
                <Select
                  items={MAX_USES_OPTIONS}
                  value={maxUses}
                  onValueChange={(v) => v && setMaxUses(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MAX_USES_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </DialogPanel>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
              >
                <HugeiconsIcon
                  icon={Link01Icon}
                  className="mr-2 size-4"
                  strokeWidth={2}
                />
                {createMutation.isPending
                  ? "Generating..."
                  : "Generate Invite Link"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
