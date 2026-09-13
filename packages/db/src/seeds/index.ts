import { seedAppUser } from "./app"
import { seedLorUser } from "./lor"
import { seedModelRates } from "./model-rates"

// Seed runner. Idempotent — safe to re-run.
await seedLorUser()
console.log("✓ seeded Lor bot user")
await seedAppUser()
console.log("✓ seeded App bot user")
await seedModelRates()
console.log("✓ seeded model rates")
process.exit(0)
