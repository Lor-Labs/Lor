import { Redirect, useLocalSearchParams } from "expo-router"

// A chat's agents are listed in its details now, each opening its own page;
// saved links to the old agent screen land there.
export default function ChannelAgentRedirect() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>()
  return (
    <Redirect
      href={{
        pathname: "/channel/[channelId]/details",
        params: { channelId: channelId ?? "" },
      }}
    />
  )
}
