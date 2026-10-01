import { useTrackToggle } from "@livekit/components-react"
import { Track } from "livekit-client"
import { useVoiceCall } from "@/context/voice-call-context"

// The mute button in the call controls and the sidebar call bar. Unmuting
// while deafened undeafens too, so the person can be heard back.
export function useMicrophoneToggle(onDeviceError?: (error: Error) => void) {
  const { deafened, toggleDeafen } = useVoiceCall()
  const microphone = useTrackToggle({
    source: Track.Source.Microphone,
    onDeviceError,
  })
  const toggle = async () => {
    if (deafened) {
      await toggleDeafen()
      await microphone.toggle(true)
      return
    }
    await microphone.toggle()
  }
  return { enabled: microphone.enabled, pending: microphone.pending, toggle }
}
