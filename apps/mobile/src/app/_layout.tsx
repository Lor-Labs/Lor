import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { HeroUINativeProvider } from "heroui-native/provider"
import { useColorScheme } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { KeyboardProvider } from "react-native-keyboard-controller"

import "../global.css"
import { AnimatedSplashOverlay } from "@/components/animated-icon"
import { SocketProvider } from "@/context/socket-context"
import { WorkspaceProvider } from "@/context/workspace-context"

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const colorScheme = useColorScheme()
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
        <KeyboardProvider>
          <ThemeProvider
            value={colorScheme === "dark" ? DarkTheme : DefaultTheme}
          >
            <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
            <AnimatedSplashOverlay />
            <SocketProvider>
              <WorkspaceProvider>
                <Stack screenOptions={{ headerShown: false }} />
              </WorkspaceProvider>
            </SocketProvider>
          </ThemeProvider>
        </KeyboardProvider>
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  )
}
