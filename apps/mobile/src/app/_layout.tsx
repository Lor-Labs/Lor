import { registerGlobals } from "@livekit/react-native"
import { QueryClientProvider } from "@tanstack/react-query"
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router"
import * as ScreenOrientation from "expo-screen-orientation"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { HeroUINativeProvider } from "heroui-native/provider"
import { useEffect } from "react"
import { useColorScheme, View } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { KeyboardProvider } from "react-native-keyboard-controller"

import "../global.css"
import { AnimatedSplashOverlay } from "@/components/animated-icon"
import { PushNotifications } from "@/components/push-notifications"
import { CallTile } from "@/components/voice/call-tile"
import { SocketProvider } from "@/context/socket-context"
import { UnreadProvider } from "@/context/unread-context"
import { VoiceCallProvider } from "@/context/voice-call-context"
import { WorkspaceProvider } from "@/context/workspace-context"
import { queryClient, subscribeQueryFocus } from "@/lib/query-client"
import { restoreThemePreference } from "@/lib/theme-preference"

SplashScreen.preventAutoHideAsync()
registerGlobals()

export default function RootLayout() {
  const colorScheme = useColorScheme()

  useEffect(() => {
    void restoreThemePreference()
  }, [])
  // The app is portrait; only the screen share viewer turns with the phone.
  useEffect(() => {
    void ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP
    )
  }, [])
  useEffect(() => subscribeQueryFocus(), [])
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <HeroUINativeProvider>
          <KeyboardProvider>
            <ThemeProvider
              value={colorScheme === "dark" ? DarkTheme : DefaultTheme}
            >
              <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
              <AnimatedSplashOverlay />
              <SocketProvider>
                <UnreadProvider>
                  <WorkspaceProvider>
                    <VoiceCallProvider>
                      <PushNotifications />
                      <View style={{ flex: 1 }}>
                        <Stack screenOptions={{ headerShown: false }} />
                        <CallTile />
                      </View>
                    </VoiceCallProvider>
                  </WorkspaceProvider>
                </UnreadProvider>
              </SocketProvider>
            </ThemeProvider>
          </KeyboardProvider>
        </HeroUINativeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  )
}
