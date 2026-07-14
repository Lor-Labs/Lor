import { Alert } from "heroui-native/alert"
import { cn } from "heroui-native/utils"
import type { ComponentProps } from "react"
import { View } from "react-native"
import { Button } from "@/components/ui/button"

export function StatePanel({
  title,
  detail,
  action,
  className,
  status = "accent",
}: {
  title: string
  detail: string
  action?: { label: string; onPress: () => void }
  className?: string
  status?: ComponentProps<typeof Alert>["status"]
}) {
  return (
    <View className={cn("justify-center px-five py-eight", className)}>
      <Alert
        className="rounded-lor-sm border border-border bg-surface-secondary shadow-none"
        status={status}
      >
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>{title}</Alert.Title>
          <Alert.Description>{detail}</Alert.Description>
          {action ? (
            <Button
              className="mt-four self-start"
              onPress={action.onPress}
              size="sm"
            >
              {action.label}
            </Button>
          ) : null}
        </Alert.Content>
      </Alert>
    </View>
  )
}
