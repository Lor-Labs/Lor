import {
  TabList,
  type TabListProps,
  TabSlot,
  Tabs,
  TabTrigger,
  type TabTriggerSlotProps,
} from "expo-router/ui"
import { Pressable, Text, View } from "react-native"

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot className="h-full" />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger asChild href="/" name="index">
            <TabButton>Home</TabButton>
          </TabTrigger>
          <TabTrigger asChild href={"/you" as never} name="you">
            <TabButton>You</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  )
}

function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable
      {...props}
      className={`rounded-lor-md px-three py-one active:opacity-70 ${
        isFocused ? "bg-lor-accent-muted dark:bg-lor-accent-muted-dark" : ""
      }`}
    >
      <Text
        className={
          isFocused
            ? "text-sm font-semibold text-lor-accent dark:text-lor-accent-dark"
            : "text-sm font-medium text-lor-text-secondary dark:text-lor-text-secondary-dark"
        }
      >
        {children}
      </Text>
    </Pressable>
  )
}

function CustomTabList(props: TabListProps) {
  return (
    <View
      {...props}
      className="absolute bottom-0 w-full flex-row items-center justify-center p-three"
    >
      <View className="w-full max-w-[900px] flex-row items-center gap-two rounded-lor-lg bg-lor-surface-raised px-five py-two dark:bg-lor-surface-raised-dark">
        <Text className="mr-auto text-sm font-bold text-lor-text dark:text-lor-text-dark">
          Lor
        </Text>
        {props.children}
      </View>
    </View>
  )
}
