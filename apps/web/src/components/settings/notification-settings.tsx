import { Notification01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Label } from "@repo/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Separator } from "@repo/ui/components/separator"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"
import {
  getNotificationPermission,
  requestNotificationPermission,
} from "@/lib/notification-dispatcher"

type NotificationSettings = {
  desktopNotifications: "all_messages" | "mentions_only" | "nothing"
  dmNotifications: "all_messages" | "nothing"
}

const DESKTOP_NOTIFICATION_OPTIONS = [
  { value: "all_messages", label: "All Messages" },
  { value: "mentions_only", label: "Mentions Only" },
  { value: "nothing", label: "Nothing" },
] as const

const DM_NOTIFICATION_OPTIONS = [
  { value: "all_messages", label: "All Messages" },
  { value: "nothing", label: "Nothing" },
] as const

export function NotificationSettings() {
  const queryClient = useQueryClient()
  const [permissionState, setPermissionState] = useState<
    "granted" | "denied" | "default"
  >("default")

  useEffect(() => {
    getNotificationPermission().then(setPermissionState)
  }, [])

  const { data: settings, isPending } = useQuery({
    queryKey: ["notification-settings"],
    queryFn: async () => {
      const res = await apiClient.v1["notification-settings"].$get()
      if (!res.ok) throw new Error("Failed to fetch notification settings")
      return res.json() as Promise<NotificationSettings>
    },
  })

  // The select shows the new value at once; a failure puts the old one back.
  const { mutate: updateSettings } = useMutation({
    mutationFn: async (update: Partial<NotificationSettings>) => {
      const res = await apiClient.v1["notification-settings"].$patch({
        json: update,
      })
      if (!res.ok) throw new Error("Failed to update notification settings")
      return res.json() as Promise<NotificationSettings>
    },
    onMutate: async (update) => {
      await queryClient.cancelQueries({ queryKey: ["notification-settings"] })
      const previous = queryClient.getQueryData<NotificationSettings>([
        "notification-settings",
      ])
      queryClient.setQueryData<NotificationSettings>(
        ["notification-settings"],
        (current) => (current ? { ...current, ...update } : current)
      )
      return { previous }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["notification-settings"], data)
    },
    onError: (_err, _update, context) => {
      queryClient.setQueryData(["notification-settings"], context?.previous)
      toast.error("Failed to update notification setting")
    },
  })

  const handleChange = (key: keyof NotificationSettings, value: string) => {
    updateSettings({ [key]: value })
  }

  const handleRequestPermission = async () => {
    const granted = await requestNotificationPermission()
    setPermissionState(granted ? "granted" : "denied")
    if (granted) {
      toast.success("Notifications enabled")
    } else {
      toast.error("Notification permission denied")
    }
  }

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Notifications</h3>
        <p className="text-sm text-muted-foreground">
          Control how and when you receive notifications.
        </p>
      </div>

      <Separator />

      {permissionState !== "granted" && (
        <div className="flex items-center gap-3 rounded-lg border p-4">
          <HugeiconsIcon
            icon={Notification01Icon}
            className="size-5 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
          <div className="flex-1">
            <p className="text-sm font-medium">Enable Desktop Notifications</p>
            <p className="text-xs text-muted-foreground">
              {permissionState === "denied"
                ? "Notifications are blocked. Please enable them in your browser settings."
                : "Allow Lor to send you desktop notifications."}
            </p>
          </div>
          {permissionState === "default" && (
            <Button size="sm" onClick={handleRequestPermission}>
              Enable
            </Button>
          )}
        </div>
      )}

      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="desktop-notifications">Desktop Notifications</Label>
          <p className="text-xs text-muted-foreground">
            Choose what triggers a desktop notification.
          </p>
          <Select
            items={DESKTOP_NOTIFICATION_OPTIONS}
            value={settings?.desktopNotifications ?? "all_messages"}
            onValueChange={(v) => v && handleChange("desktopNotifications", v)}
          >
            <SelectTrigger id="desktop-notifications" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DESKTOP_NOTIFICATION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="dm-notifications">DM Notifications</Label>
          <p className="text-xs text-muted-foreground">
            Choose whether you get notified for new direct messages.
          </p>
          <Select
            items={DM_NOTIFICATION_OPTIONS}
            value={settings?.dmNotifications ?? "all_messages"}
            onValueChange={(v) => v && handleChange("dmNotifications", v)}
          >
            <SelectTrigger id="dm-notifications" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DM_NOTIFICATION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
