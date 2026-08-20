import { createFileRoute } from "@tanstack/react-router"
import { ProductVisionDemo } from "@/components/demo/product-vision-demo"

type DemoSearch = {
  scene: number
  recording: boolean
}

export const Route = createFileRoute("/demo")({
  component: DemoRoute,
  validateSearch: (search: Record<string, unknown>): DemoSearch => {
    const requestedScene = Number(search.scene)
    const scene =
      Number.isInteger(requestedScene) &&
      requestedScene >= 1 &&
      requestedScene <= 5
        ? requestedScene
        : 1

    return {
      scene,
      recording:
        search.recording === true ||
        search.recording === "true" ||
        search.recording === "1",
    }
  },
})

function DemoRoute() {
  const { scene, recording } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <ProductVisionDemo
      scene={scene}
      recording={recording}
      onSceneChange={(nextScene) => {
        void navigate({
          search: { scene: nextScene, recording },
          replace: true,
        })
      }}
      onRecordingChange={(nextRecording) => {
        void navigate({
          search: { scene, recording: nextRecording },
          replace: true,
        })
      }}
    />
  )
}
