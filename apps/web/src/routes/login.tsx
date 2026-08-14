import { AlertCircleIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card"
import { InlineValidation } from "@repo/ui/components/interior/inline-validation"
import { Label } from "@repo/ui/components/label"
import { Spinner } from "@repo/ui/components/spinner"
import { useMutation } from "@tanstack/react-query"
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
import { type FormEvent, useEffect, useState } from "react"
import { PasswordInput } from "@/components/auth/password-input"
import { OfflineScreen } from "@/components/offline-screen"
import { useConnectivity } from "@/hooks/use-connectivity"
import { sanitizeRedirect } from "@/lib/auth-redirect"
import { validateEmail } from "@/lib/email-validation"

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: sanitizeRedirect(search.redirect),
  }),
})

function LoginPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const { redirect } = Route.useSearch()
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const { status: connectivity } = useConnectivity()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  useEffect(() => {
    if (!sessionPending && session) {
      if (redirect) {
        router.history.push(redirect)
      } else {
        navigate({ to: "/" })
      }
    }
  }, [sessionPending, session, navigate, router, redirect])

  const {
    mutate: signIn,
    isPending,
    error,
  } = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signIn.email({
        email,
        password,
        callbackURL: `${window.location.origin}${redirect ?? "/"}`,
      })
      if (error) {
        // 403 = email not verified — better-auth re-sends the verification email automatically
        if (error.status === 403) {
          navigate({ to: "/check-email", search: { email, redirect } })
          return { needsVerification: true }
        }
        throw new Error(error.message ?? "Failed to sign in")
      }
      return { needsVerification: false }
    },
    onSuccess: (result) => {
      if (!result?.needsVerification) {
        if (redirect) {
          router.history.push(redirect)
        } else {
          navigate({ to: "/" })
        }
      }
    },
  })

  // Signing in is impossible without a connection, so say that instead of
  // failing the form on submit.
  if (connectivity === "offline") return <OfflineScreen />

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link
          to="/login"
          className="flex items-center gap-2 self-center font-medium"
        >
          <img src="/lor-mark.svg" alt="Lor" className="size-6" />
          Lor
        </Link>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Welcome back</CardTitle>
              <CardDescription>Sign in to your Lor account</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  if (validateEmail(email)) return
                  signIn()
                }}
              >
                <div className="grid gap-6">
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
                  <div className="grid gap-2">
                    <div className="flex items-center">
                      <Label htmlFor="password">Password</Label>
                      <Link
                        to="/forgot-password"
                        className="ml-auto text-sm underline-offset-4 hover:underline"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <PasswordInput
                      id="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Button type="submit" disabled={isPending}>
                      {isPending ? (
                        <>
                          <Spinner className="size-4" />
                          Signing in...
                        </>
                      ) : (
                        "Sign in"
                      )}
                    </Button>
                    <p className="text-center text-sm text-muted-foreground">
                      Don&apos;t have an account?{" "}
                      <Link
                        to="/signup"
                        search={{ redirect }}
                        className="underline underline-offset-4 hover:text-primary"
                      >
                        Sign up
                      </Link>
                    </p>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
