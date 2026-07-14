import { Tabs as HeroTabs } from "heroui-native/tabs"
import type { ComponentProps } from "react"
import { triggerHaptic } from "@/components/ui/haptics"

type TabsProps = ComponentProps<typeof HeroTabs>

function TabsRoot({ onValueChange, value, ...props }: TabsProps) {
  return (
    <HeroTabs
      {...props}
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue !== value) triggerHaptic("soft")
        onValueChange(nextValue)
      }}
    />
  )
}

export const Tabs = Object.assign(TabsRoot, {
  List: HeroTabs.List,
  ScrollView: HeroTabs.ScrollView,
  Trigger: HeroTabs.Trigger,
  Label: HeroTabs.Label,
  Indicator: HeroTabs.Indicator,
  Separator: HeroTabs.Separator,
  Content: HeroTabs.Content,
})
