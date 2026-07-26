import { seedAppUser } from "./app"
import { seedMerlinUser } from "./merlin"
import { seedModelRates } from "./model-rates"

// Seed runner. Idempotent — safe to re-run.
await seedMerlinUser()
console.log("✓ seeded Merlin bot user")
await seedAppUser()
console.log("✓ seeded App bot user")
await seedModelRates()
console.log("✓ seeded model rates")
process.exit(0)
