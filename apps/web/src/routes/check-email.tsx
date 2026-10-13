import { Mail01Icon, MailValidation01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { isTauri } from "@repo/auth/tauri-fetch"
import { Button } from "@repo/ui/components/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@repo/ui/components/card"
import { Spinner } from "@repo/ui/components/spinner"
import { useMutation } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { AuthLayout } from "@/components/auth/auth-layout"
import { sanitizeRedirect } from "@/lib/auth-redirect"
import { webOrigin } from "@/lib/web-origin"

export const Route = createFileRoute("/check-email")({
  component: CheckEmailPage,
  validateSearch: (
    search: Record<string, unknown>
  ): { email: string; redirect?: string } => ({
    email: typeof search.email === "string" ? search.email : "",
    redirect: sanitizeRedirect(search.redirect),
  }),
})

function CheckEmailPage() {
  const { email, redirect } = Route.useSearch()

  const {
    mutate: resendEmail,
    isPending,
    isSuccess,
  } = useMutation({
    mutationFn: async () => {
      if (!email) return
      const { error } = await authClient.sendVerificationEmail({
        email,
        callbackURL: `${webOrigin()}${redirect ?? "/"}`,
      })
      if (error)
        throw new Error(error.message ?? "Failed to resend verification email")
    },
  })

  // The link opens in the browser, which can't hand the session back to the
  // desktop app, so desktop users sign in here afterwards.
  const instructions = isTauri
    ? "Click the link in the email to verify your account, then come back here and sign in. If you don't see it, check your spam folder."
    : "Click the link in the email to verify your account. If you don't see it, check your spam folder."

  return (
    <AuthLayout>
      <Card className="w-full border-border/50 bg-card/80 shadow-xl backdrop-blur-sm">
        <CardHeader className="flex flex-col items-center gap-4 pt-8">
          <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
            <HugeiconsIcon
              icon={Mail01Icon}
              className="size-8 text-primary"
              strokeWidth={2}
            />
          </div>
          <div className="space-y-1 text-center">
            <h2 className="text-xl font-semibold text-foreground">
              Check your email
            </h2>
            <p className="text-sm text-muted-foreground">
              We sent a verification link to
            </p>
            {email && <p className="font-medium text-foreground">{email}</p>}
          </div>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-muted-foreground">{instructions}</p>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 pb-8">
          {email && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => resendEmail()}
              disabled={isPending || isSuccess}
            >
              {isPending ? (
                <>
                  <Spinner className="size-4" />
                  Sending...
                </>
              ) : isSuccess ? (
                <>
                  <HugeiconsIcon
                    icon={MailValidation01Icon}
                    className="size-4"
                    strokeWidth={2}
                  />
                  Email sent!
                </>
              ) : (
                "Resend verification email"
              )}
            </Button>
          )}
          <Link
            to="/login"
            search={{ redirect }}
            className="text-center text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            Back to sign in
          </Link>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
