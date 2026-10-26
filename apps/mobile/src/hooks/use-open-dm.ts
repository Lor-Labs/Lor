import { features } from "@repo/utils/features"
import { useQueryClient } from "@tanstack/react-query"
import { router } from "expo-router"
import { useCallback, useRef, useState } from "react"
import { Alert } from "react-native"
import { api, responseMessage } from "@/lib/api"

export function useOpenDM() {
  const queryClient = useQueryClient()
  const [isOpening, setIsOpening] = useState(false)
  const openingRef = useRef(false)

  const openDM = useCallback(
    async (userId: string) => {
      if (!features.directMessages || openingRef.current) return
      openingRef.current = true
      setIsOpening(true)
      try {
        const response = await api.v1.dms.$post({
          json: { userIds: [userId] },
        })
        if (!response.ok) {
          throw new Error(
            await responseMessage(response, "Could not open this conversation")
          )
        }
        const payload = await response.json()
        void queryClient.invalidateQueries({ queryKey: ["dms"] })
        router.push({
          pathname: "/dm/[dmId]",
          params: { dmId: payload.dm.id },
        } as never)
      } catch (cause) {
        Alert.alert(
          "Conversation unavailable",
          cause instanceof Error
            ? cause.message
            : "Please try again in a moment."
        )
      } finally {
        openingRef.current = false
        setIsOpening(false)
      }
    },
    [queryClient]
  )

  return { openDM, isOpening }
}
