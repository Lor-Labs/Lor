import { seedAppUser } from "./app"
import { seedLorUser } from "./lor"

// Seed runner. Idempotent — safe to re-run. Model prices come from the AI
// Gateway (packages/billing/src/rates.ts), not seeds.
await seedLorUser()
console.log("✓ seeded Lor bot user")
await seedAppUser()
console.log("✓ seeded App bot user")
process.exit(0)
