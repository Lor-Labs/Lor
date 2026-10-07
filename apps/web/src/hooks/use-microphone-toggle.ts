import { useTrackToggle } from "@livekit/components-react"
import { Track } from "livekit-client"

// The mute button in the call controls and the sidebar call bar.
export function useMicrophoneToggle(onDeviceError?: (error: Error) => void) {
  const microphone = useTrackToggle({
    source: Track.Source.Microphone,
    onDeviceError,
  })
  return {
    enabled: microphone.enabled,
    pending: microphone.pending,
    toggle: () => microphone.toggle(),
  }
}
