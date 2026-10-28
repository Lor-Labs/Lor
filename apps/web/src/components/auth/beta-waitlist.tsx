import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { apiClient } from "@/lib/api-client"

export function BetaWaitlist() {
  const [email, setEmail] = useState("")
  const join = useMutation({
    mutationFn: async () => {
      const response = await apiClient.waitlist.$post({ json: { email } })
      if (!response.ok && response.status !== 409)
        throw new Error("Couldn't join the waitlist. Please try again.")
    },
  })
  if (join.isSuccess)
    return (
      <p className="text-sm">
        You're on the waitlist. We'll email you when more teams can join.
      </p>
    )
  return (
    <form
      className="mb-4 space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        join.mutate()
      }}
    >
      <Input
        type="email"
        aria-label="Waitlist email"
        placeholder="you@company.com"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Button type="submit" disabled={join.isPending}>
        Join the waitlist
      </Button>
      {join.error && (
        <p role="alert" className="text-sm text-destructive">
          {join.error.message}
        </p>
      )}
    </form>
  )
}
