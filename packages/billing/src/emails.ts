import { db, eq, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { createLogger } from "@repo/logger"
import { Resend } from "resend"
import { CREDIT_USD } from "./constants"

const logger = createLogger("billing")

let resend: Resend | null = null
function getResend() {
  if (!resend) resend = new Resend(env.RESEND_API_KEY)
  return resend
}

async function workspaceOwner(workspaceId: string) {
  const rows = await db
    .select({
      email: schema.user.email,
      workspaceName: schema.workspace.name,
      workspaceSlug: schema.workspace.slug,
    })
    .from(schema.workspace)
    .innerJoin(schema.user, eq(schema.workspace.ownerId, schema.user.id))
    .where(eq(schema.workspace.id, workspaceId))
    .limit(1)
  return rows[0] ?? null
}

function billingUrl(slug: string) {
  return `${env.APP_BASE_URL}/${slug}?settings=workspace&tab=billing`
}

// Workspace names are user-controlled and land in email HTML.
function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const EMAIL_WRAP = (body: string) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
    ${body}
  </div>
`

export async function sendBetaCreditsExhaustedEmail(
  trialId: string,
  notice: { to: string; name: string; url: string; expiresAt: string }
) {
  const { error } = await getResend().emails.send(
    {
      from: env.EMAIL_FROM,
      to: notice.to,
      subject: `Your included Lor AI credits are used up`,
      text: `${notice.name} has used its included AI credits. Buy $25 of additional credits in billing to continue using Lor-funded AI. Your workspace remains free until ${notice.expiresAt.slice(0, 10)} (UTC); buying credits does not start a seat subscription or extend the beta. No automatic refill is enabled.\n\n${notice.url}`,
      html: EMAIL_WRAP(`<h2>Your included AI credits are used up</h2>
      <p><strong>${escapeHtml(notice.name)}</strong> has used its free AI allowance.</p>
      <p>Buy $25 of additional credits to continue using Lor-funded AI. Your workspace remains free until ${escapeHtml(notice.expiresAt.slice(0, 10))} (UTC). This purchase does not start a seat subscription or extend the beta.</p>
      <p>No automatic refill is enabled. If your team has already bought more credits, you can keep using them.</p>
      <a href="${escapeHtml(notice.url)}">Open billing and buy $25 of credits</a>`),
    },
    { idempotencyKey: `beta-ai-exhausted-${trialId}` }
  )
  if (error) throw new Error(`Beta exhaustion email failed: ${error.message}`)
}

export async function sendAutoTopupChargedEmail(
  workspaceId: string,
  credits: number
) {
  const owner = await workspaceOwner(workspaceId)
  if (!owner) return
  const amount = (credits * CREDIT_USD).toFixed(2)
  const { error } = await getResend().emails.send({
    from: env.EMAIL_FROM,
    to: owner.email,
    subject: `Lor credits topped up for ${owner.workspaceName}`,
    html: EMAIL_WRAP(`
      <h2 style="margin: 0 0 8px; font-size: 24px; color: #1a1a1a;">Auto top-up receipt</h2>
      <p style="margin: 0 0 24px; color: #555; font-size: 16px; line-height: 1.5;">Your workspace <strong>${escapeHtml(owner.workspaceName)}</strong> ran low on Lor credits, so we charged your saved payment method <strong>$${amount}</strong> for <strong>${credits.toLocaleString()} credits</strong>, as configured in your auto top-up settings.</p>
      <a href="${billingUrl(owner.workspaceSlug)}" style="display: inline-block; background: #994920; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">View billing</a>
      <p style="color: #999; font-size: 13px; margin-top: 24px; line-height: 1.4;">You can change the threshold, pack size, or turn auto top-up off any time in Settings → Billing.</p>
    `),
  })
  if (error) {
    logger.error(
      { err: error, workspaceId },
      "Auto top-up receipt email failed"
    )
  }
}

export async function sendAutoTopupFailedEmail(
  workspaceId: string,
  reason?: string
) {
  const owner = await workspaceOwner(workspaceId)
  if (!owner) return
  const { error } = await getResend().emails.send({
    from: env.EMAIL_FROM,
    to: owner.email,
    subject: `Auto top-up failed for ${owner.workspaceName}`,
    html: EMAIL_WRAP(`
      <h2 style="margin: 0 0 8px; font-size: 24px; color: #1a1a1a;">Auto top-up failed</h2>
      <p style="margin: 0 0 24px; color: #555; font-size: 16px; line-height: 1.5;">We couldn't buy more Lor credits for <strong>${escapeHtml(owner.workspaceName)}</strong>${reason ? ` (${escapeHtml(reason.replaceAll("_", " "))})` : ""}. Lor will stop answering once the remaining balance runs out.</p>
      <a href="${billingUrl(owner.workspaceSlug)}" style="display: inline-block; background: #994920; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Fix payment method</a>
    `),
  })
  if (error) {
    logger.error(
      { err: error, workspaceId },
      "Auto top-up failure email failed"
    )
  }
}
