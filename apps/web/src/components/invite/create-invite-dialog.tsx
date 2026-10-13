import { Copy01Icon, Link01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
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
import { Separator } from "@repo/ui/components/separator"
import { Textarea } from "@repo/ui/components/textarea"
import { anchoredToastManager, toast } from "@repo/ui/components/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { useInviteAccess } from "@/hooks/use-invite-access"
import { apiClient } from "@/lib/api-client"
import { workspaceInvitationsQueryKey } from "@/lib/invitations"
import { getInviteUrl } from "@/lib/invite-url"
import { formatWorkspaceRole } from "@/lib/permissions"

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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseEmails(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    ),
  ]
}

export function CreateInviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const queryClient = useQueryClient()
  const { workspaceId, roleOptions } = useInviteAccess(workspaceSlug)
  const [emails, setEmails] = useState("")
  const [role, setRole] = useState("member")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [expiresIn, setExpiresIn] = useState("1440")
  const [maxUses, setMaxUses] = useState("none")
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copyButtonRef = useRef<HTMLButtonElement>(null)

  const roleItems = roleOptions.map((option) => ({
    value: option,
    label: formatWorkspaceRole(option),
  }))

  const sendMutation = useMutation({
    mutationFn: async (addresses: string[]) => {
      if (!workspaceId) throw new Error("Missing workspace")
      return Promise.all(
        addresses.map(async (email) => {
          const { error } = await authClient.organization.inviteMember({
            email,
            role,
            organizationId: workspaceId,
          })
          return { email, error: error ? (error.message ?? "Failed") : null }
        })
      )
    },
    onSuccess: (results) => {
      void queryClient.invalidateQueries({
        queryKey: workspaceInvitationsQueryKey(workspaceId),
      })
      const failed = results.filter((result) => result.error)
      const sent = results.length - failed.length
      if (sent > 0) {
        toast.success(sent === 1 ? "Invite sent" : `${sent} invites sent`)
      }
      // Keep only the failed addresses so they can be fixed and resent.
      setEmails(failed.map((result) => result.email).join(", "))
      setEmailError(failed[0] ? `${failed[0].email}: ${failed[0].error}` : null)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

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

  function handleSend() {
    const addresses = parseEmails(emails)
    if (addresses.length === 0) return
    const invalid = addresses.filter((email) => !EMAIL_PATTERN.test(email))
    if (invalid.length > 0) {
      setEmailError(`Not an email address: ${invalid.join(", ")}`)
      return
    }
    setEmailError(null)
    sendMutation.mutate(addresses)
  }

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
      setEmails("")
      setRole("member")
      setEmailError(null)
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
          <DialogTitle>Invite People</DialogTitle>
          <DialogDescription>
            Invite teammates by email, or share an invite link.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-emails">Emails</Label>
              <Textarea
                id="invite-emails"
                value={emails}
                onChange={(e) => {
                  setEmails(e.target.value)
                  setEmailError(null)
                }}
                placeholder="name@company.com, another@company.com"
                rows={3}
              />
              {emailError && (
                <p className="text-sm text-destructive">{emailError}</p>
              )}
            </div>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <Label>Role</Label>
                <Select
                  items={roleItems}
                  value={role}
                  onValueChange={(v) => v && setRole(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                onClick={handleSend}
                disabled={
                  !emails.trim() || !workspaceId || sendMutation.isPending
                }
              >
                {sendMutation.isPending ? "Sending..." : "Send Invites"}
              </Button>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Invite Link</Label>
              <p className="text-xs text-muted-foreground">
                Anyone with the link joins as a member.
              </p>
            </div>
            {inviteCode ? (
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
                  <HugeiconsIcon
                    icon={copied ? Tick02Icon : Copy01Icon}
                    className="size-4"
                    strokeWidth={2}
                  />
                </Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
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
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
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
              </>
            )}
          </div>
        </DialogPanel>

        <DialogFooter>
          {inviteCode && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setInviteCode(null)
                setCopied(false)
              }}
            >
              Create Another Link
            </Button>
          )}
          <Button type="button" onClick={() => handleOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
