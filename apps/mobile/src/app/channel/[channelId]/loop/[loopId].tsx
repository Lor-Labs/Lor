import { Redirect, useLocalSearchParams } from "expo-router"

// Loops open on their own page now (a Loop can report in no chat); saved
// links to a chat's Loop land there.
export default function ChannelLoopRedirect() {
  const { loopId } = useLocalSearchParams<{ loopId: string }>()
  return (
    <Redirect
      href={{ pathname: "/loop/[loopId]", params: { loopId: loopId ?? "" } }}
    />
  )
}
