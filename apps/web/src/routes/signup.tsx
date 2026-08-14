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
import { Input } from "@repo/ui/components/input"
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

export const Route = createFileRoute("/signup")({
  component: SignUpPage,
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: sanitizeRedirect(search.redirect),
  }),
})

function SignUpPage() {
  const navigate = useNavigate()
  const router = useRouter()
  const { redirect } = Route.useSearch()
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const { status: connectivity } = useConnectivity()
  const [name, setName] = useState("")
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
    mutate: signUp,
    isPending,
    error,
  } = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signUp.email({
        name,
        email,
        password,
        // The verification email link lands here after verifying, so the
        // redirect (e.g. an invite) survives the email round-trip
        callbackURL: `${window.location.origin}${redirect ?? "/"}`,
      })
      if (error) throw new Error(error.message ?? "Failed to create account")
    },
    onSuccess: () =>
      navigate({
        to: "/check-email",
        search: { email, redirect },
      }),
  })

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
              <CardTitle className="text-xl">Create your account</CardTitle>
              <CardDescription>
                Enter your information below to get started
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  if (validateEmail(email)) return
                  signUp()
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
                  <div className="grid gap-2">
                    <Label htmlFor="name">Display Name</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      required
                    />
                  </div>
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
                    <Label htmlFor="password">Password</Label>
                    <PasswordInput
                      id="password"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={8}
                      autoComplete="new-password"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Must be at least 8 characters long.
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Button type="submit" disabled={isPending}>
                      {isPending ? (
                        <>
                          <Spinner className="size-4" />
                          Creating account...
                        </>
                      ) : (
                        "Create Account"
                      )}
                    </Button>
                    <p className="text-center text-sm text-muted-foreground">
                      Already have an account?{" "}
                      <Link
                        to="/login"
                        search={{ redirect }}
                        className="underline underline-offset-4 hover:text-primary"
                      >
                        Sign in
                      </Link>
                    </p>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
          <p className="px-6 text-center text-xs text-muted-foreground">
            By clicking continue, you agree to our{" "}
            <span className="underline underline-offset-4 hover:text-primary">
              Terms of Service
            </span>{" "}
            and{" "}
            <span className="underline underline-offset-4 hover:text-primary">
              Privacy Policy
            </span>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
