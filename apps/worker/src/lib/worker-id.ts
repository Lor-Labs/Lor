import { randomUUID } from "node:crypto"
import { hostname } from "node:os"

// Lease owner for agent runs claimed by this worker process.
export const WORKER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
