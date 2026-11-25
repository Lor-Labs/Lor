import { AnthropicLogo } from "@repo/ui/components/logos/anthropic"
import { AWSBedrockLogo } from "@repo/ui/components/logos/aws-bedrock"
import { AzureLogo } from "@repo/ui/components/logos/azure"
import { OpenAILogo } from "@repo/ui/components/logos/openai"
import { VertexAILogo } from "@repo/ui/components/logos/vertex-ai"
import { cn } from "@repo/ui/lib/utils"
import type { KeyProvider } from "@repo/utils/inference"
import type { ComponentType } from "react"
import { apiClient } from "@/lib/api-client"

// Workspace settings → AI providers: the workspace's own model provider
// accounts (BYOK). Shared by the section and its connect dialog.

export const aiProvidersEndpoint =
  apiClient.v1.workspaces[":workspaceSlug"]["ai-providers"]

export async function fetchAiProviders(workspaceSlug: string) {
  const res = await aiProvidersEndpoint.$get({ param: { workspaceSlug } })
  if (!res.ok) throw new Error("Failed to load AI providers")
  return res.json()
}

export type AiProvidersData = Awaited<ReturnType<typeof fetchAiProviders>>
export type SavedAiProvider = AiProvidersData["providers"][number]
export type AiProviderInput = Parameters<
  typeof aiProvidersEndpoint.$put
>[0]["json"]

export const aiProvidersQueryKey = (workspaceSlug: string) => [
  "ai-providers",
  workspaceSlug,
]

const LOGOS: Record<KeyProvider, ComponentType<{ className?: string }>> = {
  anthropic: AnthropicLogo,
  openai: OpenAILogo,
  azure: AzureLogo,
  "google-vertex": VertexAILogo,
  "amazon-bedrock": AWSBedrockLogo,
}

export function AiProviderLogo({
  provider,
  className,
}: {
  provider: KeyProvider
  className?: string
}) {
  const Logo = LOGOS[provider]
  return (
    <span aria-hidden="true" className="flex">
      <Logo className={cn("size-5", className)} />
    </span>
  )
}

export const AI_PROVIDER_INFO: Record<
  KeyProvider,
  { blurb: string; credential: string; docs: string }
> = {
  anthropic: {
    blurb: "Claude models with an Anthropic API key.",
    credential: "API key",
    docs: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    blurb: "GPT and o-series models with an OpenAI API key.",
    credential: "API key",
    docs: "https://platform.openai.com/api-keys",
  },
  azure: {
    blurb: "OpenAI models served from your Azure deployments.",
    credential: "Endpoint, key and deployments",
    docs: "https://learn.microsoft.com/azure/ai-foundry/openai/how-to/create-resource",
  },
  "google-vertex": {
    blurb: "Gemini models in your Google Cloud project.",
    credential: "Service account and region",
    docs: "https://cloud.google.com/iam/docs/keys-create-delete",
  },
  "amazon-bedrock": {
    blurb: "Claude, Nova, Llama and more in your AWS account.",
    credential: "IAM access key or Bedrock API key",
    docs: "https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started.html",
  },
}

// Regions with Amazon Bedrock. The server accepts any AWS region and asks
// Bedrock to confirm it.
export const BEDROCK_REGIONS: [string, string][] = [
  ["us-east-1", "US East (N. Virginia)"],
  ["us-east-2", "US East (Ohio)"],
  ["us-west-1", "US West (N. California)"],
  ["us-west-2", "US West (Oregon)"],
  ["us-gov-east-1", "AWS GovCloud (US-East)"],
  ["us-gov-west-1", "AWS GovCloud (US-West)"],
  ["ca-central-1", "Canada (Central)"],
  ["ca-west-1", "Canada West (Calgary)"],
  ["mx-central-1", "Mexico (Central)"],
  ["sa-east-1", "South America (São Paulo)"],
  ["eu-central-1", "Europe (Frankfurt)"],
  ["eu-central-2", "Europe (Zurich)"],
  ["eu-west-1", "Europe (Ireland)"],
  ["eu-west-2", "Europe (London)"],
  ["eu-west-3", "Europe (Paris)"],
  ["eu-north-1", "Europe (Stockholm)"],
  ["eu-south-1", "Europe (Milan)"],
  ["eu-south-2", "Europe (Spain)"],
  ["il-central-1", "Israel (Tel Aviv)"],
  ["me-central-1", "Middle East (UAE)"],
  ["me-south-1", "Middle East (Bahrain)"],
  ["af-south-1", "Africa (Cape Town)"],
  ["ap-east-2", "Asia Pacific (Taipei)"],
  ["ap-northeast-1", "Asia Pacific (Tokyo)"],
  ["ap-northeast-2", "Asia Pacific (Seoul)"],
  ["ap-northeast-3", "Asia Pacific (Osaka)"],
  ["ap-south-1", "Asia Pacific (Mumbai)"],
  ["ap-south-2", "Asia Pacific (Hyderabad)"],
  ["ap-southeast-1", "Asia Pacific (Singapore)"],
  ["ap-southeast-2", "Asia Pacific (Sydney)"],
  ["ap-southeast-3", "Asia Pacific (Jakarta)"],
  ["ap-southeast-4", "Asia Pacific (Melbourne)"],
  ["ap-southeast-5", "Asia Pacific (Malaysia)"],
  ["ap-southeast-7", "Asia Pacific (Thailand)"],
]

// Vertex AI generative AI locations. Global serves the newest Gemini models.
export const VERTEX_LOCATIONS: [string, string][] = [
  ["global", "Global"],
  ["us-central1", "Iowa"],
  ["us-east1", "South Carolina"],
  ["us-east4", "Northern Virginia"],
  ["us-east5", "Columbus"],
  ["us-south1", "Dallas"],
  ["us-west1", "Oregon"],
  ["us-west4", "Las Vegas"],
  ["northamerica-northeast1", "Montréal"],
  ["southamerica-east1", "São Paulo"],
  ["europe-west1", "Belgium"],
  ["europe-west2", "London"],
  ["europe-west3", "Frankfurt"],
  ["europe-west4", "Netherlands"],
  ["europe-west6", "Zurich"],
  ["europe-west8", "Milan"],
  ["europe-west9", "Paris"],
  ["europe-north1", "Finland"],
  ["europe-central2", "Warsaw"],
  ["europe-southwest1", "Madrid"],
  ["me-central1", "Doha"],
  ["me-central2", "Dammam"],
  ["me-west1", "Tel Aviv"],
  ["asia-east1", "Taiwan"],
  ["asia-east2", "Hong Kong"],
  ["asia-northeast1", "Tokyo"],
  ["asia-northeast3", "Seoul"],
  ["asia-south1", "Mumbai"],
  ["asia-southeast1", "Singapore"],
  ["australia-southeast1", "Sydney"],
]

// One line on what a saved provider is set up with.
export function savedSummary(saved: SavedAiProvider) {
  const config = saved.config
  switch (config.provider) {
    case "anthropic":
    case "openai":
      return `Key ending ${saved.lastFour}`
    case "azure": {
      const count = config.deployments.length
      return `${new URL(config.endpoint).hostname} · ${count} ${count === 1 ? "deployment" : "deployments"}`
    }
    case "google-vertex":
      return `${config.project} · ${config.location}`
    case "amazon-bedrock":
      return `${config.region} · ${config.authMethod === "api_key" ? "API key" : "Access key"} ending ${saved.lastFour}`
  }
}
