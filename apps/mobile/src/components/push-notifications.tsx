import { usePushNotifications } from "@/hooks/use-push-notifications"
import { useSubscribedToasts } from "@/hooks/use-subscribed-toasts"

export function PushNotifications() {
  usePushNotifications()
  useSubscribedToasts()
  return null
}
