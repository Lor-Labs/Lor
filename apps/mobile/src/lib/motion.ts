import {
  cubicBezier,
  Easing,
  FadeIn,
  FadeOut,
  Keyframe,
  LinearTransition,
} from "react-native-reanimated"

// The app's motion values in one place, so press feedback, list reflow and
// crossfades feel like one product. Curves: a strong ease-out for anything
// entering, leaving or answering a press (the built-in ease-out is too weak
// to read as responsive), ease-in-out for things moving on screen. UI motion
// stays under 300ms; exits run faster than entrances.

// For withTiming and layout-animation builders.
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1)

// The same curves for Reanimated CSS transitions (transitionTimingFunction).
export const CSS_EASE_OUT = cubicBezier(0.23, 1, 0.32, 1)
export const CSS_EASE_IN_OUT = cubicBezier(0.77, 0, 0.175, 1)

export const PRESS_MS = 120
export const STATE_MS = 180
export const REFLOW_MS = 220

// How long a touch rests on something in a scrolling list before it shows
// as pressed (Pressable's unstable_pressDelay). A scroll that starts there
// takes the touch sooner than this, so scrolling never flashes what is
// under the finger. A quick tap still shows: its feedback comes at release
// and holds a moment. Native lists wait 150ms.
export const SCROLL_PRESS_DELAY_MS = 110

// Rows joining or leaving a list (a section folding, a session arriving):
// they fade while their neighbours slide to the new place. A leaving row is
// gone before the rows below reach it, and a joining row waits a beat for
// them to clear its place, so two rows' text never shows through each other.
// Built once here: a builder made during render is rebuilt on every render.
export const ROW_ENTER = FadeIn.duration(STATE_MS).delay(60).easing(EASE_OUT)
export const ROW_EXIT = FadeOut.duration(100).easing(EASE_OUT)
export const LIST_REFLOW = LinearTransition.duration(REFLOW_MS).easing(EASE_OUT)

// A small mark arriving on a row that is already there (a mention badge):
// it grows the last bit of the way in, never from nothing.
export const POP_ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.85 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
}).duration(STATE_MS)
export const POP_EXIT = FadeOut.duration(PRESS_MS).easing(EASE_OUT)

// One view replacing another in place (skeleton to content, list to search
// results).
export const SWAP_ENTER = FadeIn.duration(STATE_MS).easing(EASE_OUT)
export const SWAP_EXIT = FadeOut.duration(PRESS_MS).easing(EASE_OUT)
