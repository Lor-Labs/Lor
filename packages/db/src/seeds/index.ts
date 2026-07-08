import { seedAppUser } from "./app"
import { seedMerlinUser } from "./merlin"

// Seed runner. Idempotent — safe to re-run.
await seedMerlinUser()
console.log("✓ seeded Merlin bot user")
await seedAppUser()
console.log("✓ seeded App bot user")
process.exit(0)
