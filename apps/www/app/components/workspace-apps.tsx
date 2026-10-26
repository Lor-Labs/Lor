"use client"

import { Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { AttioLogo } from "@repo/ui/components/logos/attio"
import { useState } from "react"
import { FileCard, WorkLog } from "@/app/components/mock-parts"
import {
  PreviewDocument,
  PreviewTurn,
} from "@/app/components/workspace-preview"

const ACCOUNTS = [
  {
    name: "Tidemark",
    detail: "Hiring a first sales rep",
    status: "New account",
  },
  { name: "Morrow", detail: "Founder-led sales team", status: "New account" },
  {
    name: "Goodfield",
    detail: "Expanding its sales team",
    status: "Already in Attio",
  },
]

export function ChannelWorkflow() {
  const [approved, setApproved] = useState(false)

  return (
    <PreviewDocument
      title="This week’s accounts"
      channel="gtm"
      starter="Rafael"
    >
      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-lor-text-tertiary-dark">
        <span className="size-1.5 rounded-full bg-agent" />
        Every Monday · 9:00 AM
      </p>
      <PreviewTurn person="Rafael">
        Each Monday, find accounts that fit Zoe&rsquo;s criteria. Check Attio
        for existing relationships and prepare a shortlist for us.
      </PreviewTurn>
      <PreviewTurn person="Lor">
        <WorkLog
          label="Worked"
          detail="Read channel instructions · Searched the web · Checked Attio"
        />
        <p className="mt-3">
          Tidemark and Morrow fit the criteria. Goodfield is already in Attio,
          so I&rsquo;ve kept it out of the new-account list.
        </p>
        <div className="mt-4 divide-y divide-lor-border-dark/60 border-y border-lor-border-dark/60">
          {ACCOUNTS.map((account) => (
            <div
              key={account.name}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5"
            >
              <div>
                <p className="text-xs font-medium text-lor-text-dark">
                  {account.name}
                </p>
                <p className="mt-0.5 text-[11px] text-lor-text-tertiary-dark">
                  {account.detail}
                </p>
              </div>
              <span className="text-[10px] text-lor-text-tertiary-dark">
                {account.status}
              </span>
            </div>
          ))}
        </div>
        <FileCard
          name="account-shortlist.csv"
          detail="Research and reasons to reach out"
        />
      </PreviewTurn>
      <PreviewTurn person="Zoe" aside>
        Tidemark looks right. Add it to Attio so Rafael can pick it up.
      </PreviewTurn>
      <div className="mt-5 rounded-lg border border-lor-border-dark/70 bg-lor-sidebar-dark/40 p-3.5">
        <div className="flex items-start gap-2.5">
          <AttioLogo className="mt-0.5 size-4 shrink-0 text-lor-text-secondary-dark" />
          <div>
            <p className="text-xs font-medium text-lor-text-dark">
              Create Tidemark in Attio
            </p>
            <p className="mt-1 text-[11px] text-lor-text-tertiary-dark">
              This team requires approval for new CRM records.
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-lor-border-dark/60 pt-3">
          <p
            role="status"
            className="flex items-center gap-1.5 text-[11px] text-lor-text-secondary-dark"
          >
            {approved ? <HugeiconsIcon icon={Tick02Icon} size={13} /> : null}
            {approved ? "Approved by Zoe" : "Waiting for Zoe’s approval"}
          </p>
          <button
            type="button"
            onClick={() => setApproved((current) => !current)}
            className="min-h-10 cursor-pointer rounded-md bg-agent/15 px-3 text-xs font-medium text-agent hover:bg-agent/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent"
          >
            {approved ? "Reset" : "Approve"}
          </button>
        </div>
      </div>
    </PreviewDocument>
  )
}
