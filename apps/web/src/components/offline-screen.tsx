import { Loading03Icon, NoInternetIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@repo/ui/components/card"
import { AuthLayout } from "@/components/auth/auth-layout"
import { useConnectivity } from "@/hooks/use-connectivity"

export function OfflineScreen() {
  const { isChecking, recheck } = useConnectivity()

  return (
    <AuthLayout>
      <Card className="w-full border-border/50 bg-card/80 shadow-xl backdrop-blur-sm">
        <CardHeader className="flex flex-col items-center gap-4 pt-8">
          <div className="flex size-16 items-center justify-center rounded-full bg-muted ring-1 ring-border">
            <HugeiconsIcon
              icon={NoInternetIcon}
              className="size-8 text-muted-foreground"
            />
          </div>
          <div className="space-y-1 text-center">
            <h2 className="text-xl font-semibold text-foreground">
              No internet connection
            </h2>
            <p className="text-sm text-muted-foreground">
              Lor can't reach the server right now.
            </p>
          </div>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-muted-foreground">
            Check your network connection - this screen goes away on its own
            once you're back online.
          </p>
        </CardContent>
        <CardFooter className="pb-8">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void recheck()}
            disabled={isChecking}
          >
            {isChecking ? (
              <>
                <HugeiconsIcon
                  icon={Loading03Icon}
                  className="size-4 animate-spin"
                />
                Checking...
              </>
            ) : (
              "Try again"
            )}
          </Button>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
