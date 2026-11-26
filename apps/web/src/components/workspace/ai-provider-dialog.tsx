import {
  Add01Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  LinkSquare02Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert, AlertDescription } from "@repo/ui/components/alert"
import { Button } from "@repo/ui/components/button"
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { CodeBlock } from "@repo/ui/components/tool-ui/code-block"
import { cn } from "@repo/ui/lib/utils"
import { KEY_PROVIDER_NAMES, type KeyProvider } from "@repo/utils/inference"
import { useMutation } from "@tanstack/react-query"
import { type ReactNode, useId, useRef, useState } from "react"
import { openInNewTab } from "@/lib/open-external"
import {
  AI_PROVIDER_INFO,
  type AiProviderInput,
  AiProviderLogo,
  type AiProvidersData,
  aiProvidersEndpoint,
  BEDROCK_REGIONS,
  type SavedAiProvider,
  VERTEX_LOCATIONS,
} from "./ai-provider-meta"
import { IconTile } from "./settings-group"

// Connect or edit one AI provider. The server verifies the credential with
// the provider before saving; its message shows in the dialog. When editing,
// blank secret fields keep the saved secret.

type ConfigOf<P extends KeyProvider> = Extract<
  SavedAiProvider["config"],
  { provider: P }
>

type FormProps<P extends KeyProvider> = {
  saved: ConfigOf<P> | null
  lastFour: string | null
  onSubmit: (input: AiProviderInput) => void
}

const KEEP_SAVED = "Saved · leave blank to keep"

export function AiProviderDialog({
  provider,
  open,
  formKey,
  onOpenChange,
  saved,
  azureModels,
  workspaceSlug,
  onSaved,
}: {
  provider: KeyProvider
  open: boolean
  // Changes on each open, so the form starts fresh.
  formKey: number
  onOpenChange: (open: boolean) => void
  saved: SavedAiProvider | undefined
  azureModels: AiProvidersData["azureModels"]
  workspaceSlug: string
  onSaved: (next: AiProvidersData) => void
}) {
  const name = KEY_PROVIDER_NAMES[provider]
  const save = useMutation({
    mutationFn: async (json: AiProviderInput) => {
      const res = await aiProvidersEndpoint.$put({
        param: { workspaceSlug },
        json,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(
          body && "message" in body
            ? body.message
            : "Couldn't save. Check the details and try again."
        )
      }
      return res.json()
    },
    onSuccess: ({ notice, ...next }) => {
      if (notice) toast.warning(notice)
      else toast.success(saved ? `${name} updated` : `${name} connected`)
      onSaved(next)
    },
  })
  const close = () => {
    if (save.isPending) return
    save.reset()
    onOpenChange(false)
  }
  const common = {
    lastFour: saved?.lastFour ?? null,
    onSubmit: (input: AiProviderInput) => save.mutate(input),
  }
  const config = saved?.config

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close()
        else onOpenChange(true)
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <IconTile>
              <AiProviderLogo provider={provider} />
            </IconTile>
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-lg">
                {saved ? `Edit ${name}` : `Connect ${name}`}
              </DialogTitle>
              <DialogDescription>
                {AI_PROVIDER_INFO[provider].blurb}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div key={formKey} className="flex min-h-0 flex-1 flex-col">
          {provider === "azure" ? (
            <AzureForm
              {...common}
              saved={config?.provider === "azure" ? config : null}
              azureModels={azureModels}
            />
          ) : provider === "google-vertex" ? (
            <VertexForm
              {...common}
              saved={config?.provider === "google-vertex" ? config : null}
            />
          ) : provider === "amazon-bedrock" ? (
            <BedrockForm
              {...common}
              saved={config?.provider === "amazon-bedrock" ? config : null}
            />
          ) : (
            <ApiKeyForm
              {...common}
              provider={provider}
              saved={
                config?.provider === "anthropic" ||
                config?.provider === "openai"
                  ? config
                  : null
              }
            />
          )}
          {save.error && (
            <div className="px-6 pb-4">
              <Alert variant="error">
                <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={2} />
                <AlertDescription className="text-foreground">
                  {save.error.message}
                </AlertDescription>
              </Alert>
            </div>
          )}
          <FormFooter
            provider={provider}
            form={`ai-provider-${provider}`}
            editing={Boolean(saved)}
            pending={save.isPending}
            onCancel={close}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FormFooter({
  provider,
  form,
  editing,
  pending,
  onCancel,
}: {
  provider: KeyProvider
  form: string
  editing: boolean
  pending: boolean
  onCancel: () => void
}) {
  return (
    <DialogFooter className="sm:justify-between">
      <Button
        type="button"
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => openInNewTab(AI_PROVIDER_INFO[provider].docs)}
      >
        Setup guide
        <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} />
      </Button>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" form={form} loading={pending}>
          {pending ? "Verifying…" : editing ? "Save changes" : "Connect"}
        </Button>
      </div>
    </DialogFooter>
  )
}

function ProviderForm({
  provider,
  onSubmit,
  children,
}: {
  provider: KeyProvider
  onSubmit: () => void
  children: ReactNode
}) {
  return (
    <DialogPanel>
      <form
        id={`ai-provider-${provider}`}
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        {children}
      </form>
    </DialogPanel>
  )
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  savedHint,
  autoFocus,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  // Set when a secret is saved: the field may stay blank.
  savedHint: string | null
  autoFocus?: boolean
}) {
  return (
    <Input
      id={id}
      type="password"
      autoComplete="off"
      spellCheck={false}
      autoFocus={autoFocus}
      placeholder={savedHint ?? placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <button
      type="button"
      className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline"
      onClick={() => openInNewTab(href)}
    >
      {children}
    </button>
  )
}

function RegionSelect({
  id,
  value,
  regions,
  onChange,
}: {
  id: string
  value: string
  regions: [string, string][]
  onChange: (value: string) => void
}) {
  const items = regions.map(([region, label]) => ({
    value: region,
    label: label.toLowerCase() === region ? label : `${label} · ${region}`,
  }))
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next)
      }}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ApiKeyForm({
  provider,
  saved,
  lastFour,
  onSubmit,
}: FormProps<"anthropic" | "openai"> & { provider: KeyProvider }) {
  const id = useId()
  const [apiKey, setApiKey] = useState("")
  const anthropic = provider === "anthropic"
  return (
    <ProviderForm
      provider={provider}
      onSubmit={() =>
        onSubmit({
          provider: anthropic ? "anthropic" : "openai",
          apiKey,
        })
      }
    >
      <Field
        id={id}
        label={saved ? "New API key" : "API key"}
        hint={
          <>
            {saved ? `Replaces the key ending ${lastFour}. ` : ""}Create one in
            the{" "}
            <ExternalLink href={AI_PROVIDER_INFO[provider].docs}>
              {anthropic ? "Anthropic Console" : "OpenAI dashboard"}
            </ExternalLink>
            . Subscription tokens aren't supported.
          </>
        }
      >
        <SecretInput
          id={id}
          autoFocus
          value={apiKey}
          onChange={setApiKey}
          placeholder={anthropic ? "sk-ant-api…" : "sk-…"}
          savedHint={null}
        />
      </Field>
    </ProviderForm>
  )
}

type DeploymentRow = { key: number; model: string; deployment: string }

function AzureForm({
  saved,
  lastFour,
  onSubmit,
  azureModels,
}: FormProps<"azure"> & { azureModels: AiProvidersData["azureModels"] }) {
  const id = useId()
  const nextKey = useRef(0)
  const row = (model = "", deployment = ""): DeploymentRow => ({
    key: nextKey.current++,
    model,
    deployment,
  })
  const [endpoint, setEndpoint] = useState(saved?.endpoint ?? "")
  const [apiKey, setApiKey] = useState("")
  const [rows, setRows] = useState<DeploymentRow[]>(() =>
    saved?.deployments.length
      ? saved.deployments.map((item) => row(item.model, item.deployment))
      : [row()]
  )
  const items = azureModels.map((model) => ({
    value: model.id,
    label: model.name,
  }))
  const update = (key: number, change: Partial<DeploymentRow>) =>
    setRows((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change } : item))
    )

  return (
    <ProviderForm
      provider="azure"
      onSubmit={() =>
        onSubmit({
          provider: "azure",
          endpoint,
          ...(apiKey.trim() ? { apiKey } : {}),
          deployments: rows
            .filter((item) => item.model)
            .map(({ model, deployment }) => ({ model, deployment })),
        })
      }
    >
      <Field
        id={`${id}-endpoint`}
        label="Endpoint"
        hint="On your Azure OpenAI or AI Foundry resource, under Keys and Endpoint."
      >
        <Input
          id={`${id}-endpoint`}
          autoComplete="off"
          spellCheck={false}
          autoFocus={!saved}
          placeholder="https://my-resource.openai.azure.com"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
        />
      </Field>
      <Field id={`${id}-key`} label="API key">
        <SecretInput
          id={`${id}-key`}
          value={apiKey}
          onChange={setApiKey}
          placeholder="Key 1 or Key 2"
          savedHint={
            saved ? `Key ending ${lastFour} · leave blank to keep` : null
          }
        />
      </Field>
      <div className="space-y-2">
        <div className="space-y-0.5">
          <Label>Deployments</Label>
          <p className="text-xs text-muted-foreground">
            The models you deployed and their deployment names. Only these show
            up in the model picker.
          </p>
        </div>
        <div className="space-y-2">
          {rows.map((item) => (
            <div key={item.key} className="flex items-center gap-2">
              <Select
                items={items}
                value={item.model || null}
                onValueChange={(model) => {
                  if (typeof model !== "string") return
                  // The name follows the model until someone edits it.
                  const follows =
                    !item.deployment || item.deployment === item.model
                  update(item.key, {
                    model,
                    ...(follows ? { deployment: model } : {}),
                  })
                }}
              >
                <SelectTrigger
                  aria-label="Model"
                  className="w-auto min-w-0 flex-1"
                >
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Deployment name"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1"
                placeholder="Deployment name"
                value={item.deployment}
                onChange={(event) =>
                  update(item.key, { deployment: event.target.value })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove deployment"
                disabled={rows.length === 1}
                onClick={() =>
                  setRows((current) =>
                    current.filter((other) => other.key !== item.key)
                  )
                }
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          onClick={() => setRows((current) => [...current, row()])}
        >
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Add deployment
        </Button>
      </div>
    </ProviderForm>
  )
}

// What the pasted or uploaded key file says, to confirm it before saving.
function readServiceAccount(text: string) {
  try {
    const json: unknown = JSON.parse(text)
    if (typeof json !== "object" || json === null) return null
    const record = json as Record<string, unknown>
    return record.type === "service_account" &&
      typeof record.client_email === "string"
      ? {
          clientEmail: record.client_email,
          projectId:
            typeof record.project_id === "string" ? record.project_id : null,
        }
      : null
  } catch {
    return null
  }
}

function VertexForm({ saved, onSubmit }: FormProps<"google-vertex">) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [keyText, setKeyText] = useState("")
  const [project, setProject] = useState(saved?.project ?? "")
  // Typed by the person: a new key's project no longer replaces it.
  const [projectTyped, setProjectTyped] = useState(false)
  const [location, setLocation] = useState(saved?.location ?? "global")
  const parsed = keyText.trim() ? readServiceAccount(keyText) : null
  const loadKey = (text: string) => {
    setKeyText(text)
    const account = readServiceAccount(text)
    if (account?.projectId && !projectTyped) setProject(account.projectId)
  }

  return (
    <ProviderForm
      provider="google-vertex"
      onSubmit={() =>
        onSubmit({
          provider: "google-vertex",
          ...(keyText.trim() ? { serviceAccountKey: keyText } : {}),
          ...(project.trim() ? { project } : {}),
          location,
        })
      }
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={`${id}-key`}>Service account key</Label>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => fileRef.current?.click()}
          >
            <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} />
            Upload JSON
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (file) void file.text().then(loadKey)
            }}
          />
        </div>
        <Textarea
          id={`${id}-key`}
          autoComplete="off"
          spellCheck={false}
          className="max-h-32 font-mono text-xs"
          placeholder={
            saved
              ? `${saved.clientEmail}\n${KEEP_SAVED}`
              : '{ "type": "service_account", "project_id": … }'
          }
          value={keyText}
          onChange={(event) => loadKey(event.target.value)}
          aria-invalid={(keyText.trim() && !parsed) || undefined}
        />
        {keyText.trim() ? (
          parsed ? (
            <p className="flex items-center gap-1.5 text-xs text-success-foreground">
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                className="size-3.5"
                strokeWidth={2}
              />
              {parsed.clientEmail}
            </p>
          ) : (
            <p className="text-xs text-destructive-foreground">
              This isn't a service account JSON key.
            </p>
          )
        ) : (
          <p className="text-xs text-muted-foreground">
            A JSON key for a service account with the Vertex AI User role.{" "}
            <ExternalLink href={AI_PROVIDER_INFO["google-vertex"].docs}>
              Create a key
            </ExternalLink>
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${id}-project`}
          label="Project ID"
          hint="Read from the key when left blank."
        >
          <Input
            id={`${id}-project`}
            autoComplete="off"
            spellCheck={false}
            placeholder="my-project"
            value={project}
            onChange={(event) => {
              setProject(event.target.value)
              setProjectTyped(true)
            }}
          />
        </Field>
        <Field
          id={`${id}-location`}
          label="Region"
          hint="Global serves the newest Gemini models."
        >
          <RegionSelect
            id={`${id}-location`}
            value={location}
            regions={VERTEX_LOCATIONS}
            onChange={setLocation}
          />
        </Field>
      </div>
    </ProviderForm>
  )
}

// One run with IAM admin access: an IAM user that can only call Bedrock
// models, and its access key, labeled like the fields above.
const BEDROCK_KEY_COMMAND = `aws iam create-user --user-name lor-bedrock --no-cli-pager --output text --query User.Arn && \\
aws iam put-user-policy --user-name lor-bedrock --policy-name lor-bedrock-invoke --no-cli-pager --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream","bedrock:ListFoundationModels"],"Resource":"*"}]}' && \\
aws iam create-access-key --user-name lor-bedrock --no-cli-pager --output text --query 'AccessKey.[AccessKeyId,SecretAccessKey]' | awk '{print "Access key ID:     " $1; print "Secret access key: " $2}'`

function BedrockForm({
  saved,
  lastFour,
  onSubmit,
}: FormProps<"amazon-bedrock">) {
  const id = useId()
  const [region, setRegion] = useState(saved?.region ?? "us-east-1")
  const [method, setMethod] = useState(saved?.authMethod ?? "access_key")
  const [accessKeyId, setAccessKeyId] = useState(saved?.accessKeyId ?? "")
  const [secretAccessKey, setSecretAccessKey] = useState("")
  const [apiKey, setApiKey] = useState("")
  // The saved secret is kept only for the same method (and access key ID).
  const keepSecret =
    saved?.authMethod === method &&
    (method === "api_key" || saved.accessKeyId === accessKeyId.trim())
  const regions = BEDROCK_REGIONS.some(([value]) => value === region)
    ? BEDROCK_REGIONS
    : [...BEDROCK_REGIONS, [region, region] as [string, string]]

  return (
    <ProviderForm
      provider="amazon-bedrock"
      onSubmit={() =>
        onSubmit(
          method === "api_key"
            ? {
                provider: "amazon-bedrock",
                region,
                authMethod: "api_key",
                ...(apiKey.trim() ? { apiKey } : {}),
              }
            : {
                provider: "amazon-bedrock",
                region,
                authMethod: "access_key",
                accessKeyId,
                ...(secretAccessKey.trim() ? { secretAccessKey } : {}),
              }
        )
      }
    >
      <Field
        id={`${id}-region`}
        label="Region"
        hint="The model picker lists the models and cross-region profiles this region can call."
      >
        <RegionSelect
          id={`${id}-region`}
          value={region}
          regions={regions}
          onChange={setRegion}
        />
      </Field>
      <div className="space-y-2">
        <Label>Sign in with</Label>
        <div
          role="radiogroup"
          aria-label="Sign in with"
          className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
        >
          {(
            [
              ["access_key", "IAM access key"],
              ["api_key", "Bedrock API key"],
            ] as const
          ).map(([value, label]) => (
            // biome-ignore lint/a11y/useSemanticElements: a segmented control, styled as buttons
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={method === value}
              onClick={() => setMethod(value)}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                method === value
                  ? "bg-background font-medium text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {method === "access_key" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-access-key`} label="Access key ID">
              <Input
                id={`${id}-access-key`}
                autoComplete="off"
                spellCheck={false}
                placeholder="AKIA…"
                value={accessKeyId}
                onChange={(event) => setAccessKeyId(event.target.value)}
              />
            </Field>
            <Field id={`${id}-secret`} label="Secret access key">
              <SecretInput
                id={`${id}-secret`}
                value={secretAccessKey}
                onChange={setSecretAccessKey}
                placeholder="Secret"
                savedHint={keepSecret ? KEEP_SAVED : null}
              />
            </Field>
          </div>
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className="size-3.5 transition-transform group-data-[panel-open]:rotate-180"
              />
              No access key yet? Create one with the AWS CLI
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="space-y-1.5 pt-2">
                <CodeBlock
                  id="bedrock-provision-keys"
                  code={BEDROCK_KEY_COMMAND}
                  language="bash"
                  lineNumbers="hidden"
                  className="min-w-0"
                />
                <p className="text-xs text-muted-foreground">
                  Needs IAM admin access. It creates a user that can only call
                  Bedrock models and prints the two values to paste above.
                </p>
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </>
      ) : (
        <Field
          id={`${id}-api-key`}
          label="Bedrock API key"
          hint={
            <>
              Create a long-term key in the Bedrock console under API keys.{" "}
              <ExternalLink href="https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html">
                How API keys work
              </ExternalLink>
            </>
          }
        >
          <SecretInput
            id={`${id}-api-key`}
            value={apiKey}
            onChange={setApiKey}
            placeholder="ABSK…"
            savedHint={
              keepSecret ? `Key ending ${lastFour} · leave blank to keep` : null
            }
          />
        </Field>
      )}
    </ProviderForm>
  )
}
