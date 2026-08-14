import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  MailValidation01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card"
import { InlineValidation } from "@repo/ui/components/interior/inline-validation"
import { Spinner } from "@repo/ui/components/spinner"
import { useMutation } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { AuthLayout } from "@/components/auth/auth-layout"
import { validateEmail } from "@/lib/email-validation"

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const [email, setEmail] = useState("")

  const {
    mutate: sendReset,
    isPending,
    isSuccess,
    error,
  } = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      })
      if (error) throw new Error(error.message ?? "Failed to send reset email")
    },
  })

  if (isSuccess) {
    return (
      <AuthLayout>
        <Card className="w-full border-border/50 bg-card/80 shadow-xl backdrop-blur-sm">
          <CardHeader className="flex flex-col items-center gap-4 pt-8">
            <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
              <HugeiconsIcon
                icon={MailValidation01Icon}
                className="size-8 text-primary"
                strokeWidth={2}
              />
            </div>
            <div className="space-y-1 text-center">
              <h2 className="text-xl font-semibold text-foreground">
                Check your email
              </h2>
              <p className="text-sm text-muted-foreground">
                If an account exists for{" "}
                <span className="font-medium text-foreground">{email}</span>, we
                sent a password reset link.
              </p>
            </div>
          </CardHeader>
          <CardFooter className="flex justify-center pb-8">
            <Link
              to="/login"
              className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <HugeiconsIcon
                icon={ArrowLeft01Icon}
                className="size-3.5"
                strokeWidth={2}
              />
              Back to sign in
            </Link>
          </CardFooter>
        </Card>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <Card className="w-full border-border/50 bg-card/80 shadow-xl backdrop-blur-sm">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-semibold">
            Reset password
          </CardTitle>
          <CardDescription>
            Enter your email and we'll send you a reset link
          </CardDescription>
        </CardHeader>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (validateEmail(email)) return
            sendReset()
          }}
        >
          <CardContent className="flex flex-col gap-4">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                <HugeiconsIcon
                  icon={AlertCircleIcon}
                  className="size-4 shrink-0"
                  strokeWidth={2}
                />
                <span>{error.message}</span>
              </div>
            )}
            <InlineValidation
              id="email"
              name="email"
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={setEmail}
              validate={validateEmail}
              autoComplete="email"
              required
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? (
                <>
                  <Spinner className="size-4" />
                  Sending...
                </>
              ) : (
                "Send reset link"
              )}
            </Button>
            <Link
              to="/login"
              className="flex items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <HugeiconsIcon
                icon={ArrowLeft01Icon}
                className="size-3.5"
                strokeWidth={2}
              />
              Back to sign in
            </Link>
          </CardFooter>
        </form>
      </Card>
    </AuthLayout>
  )
}
