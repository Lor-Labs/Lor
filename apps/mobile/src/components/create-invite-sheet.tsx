import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import Link01Icon from "@hugeicons/core-free-icons/Link01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import * as Clipboard from "expo-clipboard"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { useEffect, useRef, useState } from "react"
import { Pressable, Share, Text, View } from "react-native"
import { Button } from "@/components/ui/button"
import { SectionLabel } from "@/components/ui/section-label"
import { api } from "@/lib/api"
import { inviteUrl } from "@/lib/invites"

const EXPIRY_OPTIONS = [
  { label: "30 minutes", value: "30" },
  { label: "1 hour", value: "60" },
  { label: "6 hours", value: "360" },
  { label: "12 hours", value: "720" },
  { label: "1 day", value: "1440" },
  { label: "7 days", value: "10080" },
  { label: "Never", value: "never" },
]

const MAX_USES_OPTIONS = [
  { label: "No limit", value: "none" },
  { label: "1 use", value: "1" },
  { label: "5 uses", value: "5" },
  { label: "10 uses", value: "10" },
  { label: "25 uses", value: "25" },
  { label: "50 uses", value: "50" },
  { label: "100 uses", value: "100" },
]

export function CreateInviteSheet({
  isOpen,
  onOpenChange,
  workspaceName,
  workspaceSlug,
}: {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  workspaceName: string
  workspaceSlug: string
}) {
  const [expiresIn, setExpiresIn] = useState("1440")
  const [maxUses, setMaxUses] = useState("none")
  const [createdCode, setCreatedCode] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const foreground = useThemeColor("foreground")

  useEffect(() => {
    if (!isOpen) return
    setExpiresIn("1440")
    setMaxUses("none")
    setCreatedCode(null)
    setIsCopied(false)
    setError(null)
  }, [isOpen])

  useEffect(
    () => () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
    },
    []
  )

  const createInvite = async () => {
    if (isCreating) return
    setIsCreating(true)
    setError(null)
    try {
      const response = await api.v1.workspaces[":workspaceSlug"].invites.$post({
        param: { workspaceSlug },
        json: {
          expiresInMinutes: expiresIn === "never" ? null : Number(expiresIn),
          maxUses: maxUses === "none" ? null : Number(maxUses),
        },
      })
      if (!response.ok) {
        throw new Error(
          await responseMessage(response, "Could not create invite")
        )
      }
      const payload = await response.json()
      setCreatedCode(payload.invite.code)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create invite"
      )
    } finally {
      setIsCreating(false)
    }
  }

  const copyLink = async () => {
    if (!createdCode) return
    await Clipboard.setStringAsync(inviteUrl(createdCode))
    setIsCopied(true)
    if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
    copiedTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000)
  }

  const shareLink = () => {
    if (!createdCode) return
    void Share.share({ message: inviteUrl(createdCode) })
  }

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          enableDynamicSizing={false}
          snapPoints={["68%", "92%"]}
        >
          <BottomSheetScrollView
            contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            <View className="flex-row items-start gap-three px-one">
              <View className="size-10 items-center justify-center rounded-lor-sm bg-surface-secondary">
                <HugeiconsIcon color={foreground} icon={Link01Icon} size={20} />
              </View>
              <View className="min-w-0 flex-1 gap-px">
                <BottomSheet.Title>Invite people</BottomSheet.Title>
                <BottomSheet.Description>
                  Share a link that lets anyone join {workspaceName}.
                </BottomSheet.Description>
              </View>
              <BottomSheet.Close />
            </View>

            {createdCode ? (
              <>
                <View className="gap-two px-one">
                  <SectionLabel>Invite link</SectionLabel>
                  <View className="min-h-12 justify-center rounded-lor-sm border border-border bg-surface px-three">
                    <Text className="text-[15px] text-foreground" selectable>
                      {inviteUrl(createdCode)}
                    </Text>
                  </View>
                </View>
                <View className="gap-two px-one">
                  <Button onPress={() => void copyLink()}>
                    {isCopied ? "Copied!" : "Copy link"}
                  </Button>
                  <Button onPress={shareLink} variant="secondary">
                    Share…
                  </Button>
                  <Button
                    onPress={() => {
                      setCreatedCode(null)
                      setIsCopied(false)
                    }}
                    variant="ghost"
                  >
                    Create another link
                  </Button>
                </View>
              </>
            ) : (
              <>
                <View className="gap-two px-one">
                  <SectionLabel>Expires after</SectionLabel>
                  <View className="flex-row flex-wrap gap-two">
                    {EXPIRY_OPTIONS.map((option) => (
                      <OptionChip
                        isSelected={expiresIn === option.value}
                        key={option.value}
                        label={option.label}
                        onPress={() => setExpiresIn(option.value)}
                      />
                    ))}
                  </View>
                </View>
                <View className="gap-two px-one">
                  <SectionLabel>Max uses</SectionLabel>
                  <View className="flex-row flex-wrap gap-two">
                    {MAX_USES_OPTIONS.map((option) => (
                      <OptionChip
                        isSelected={maxUses === option.value}
                        key={option.value}
                        label={option.label}
                        onPress={() => setMaxUses(option.value)}
                      />
                    ))}
                  </View>
                </View>
                {error ? (
                  <Text className="px-one text-sm font-medium text-danger">
                    {error}
                  </Text>
                ) : null}
                <View className="px-one">
                  <Button
                    isDisabled={isCreating}
                    onPress={() => void createInvite()}
                  >
                    {isCreating ? "Generating…" : "Generate invite link"}
                  </Button>
                </View>
              </>
            )}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function OptionChip({
  isSelected,
  label,
  onPress,
}: {
  isSelected: boolean
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      className={`min-h-9 items-center justify-center rounded-full border px-three active:opacity-70 ${
        isSelected ? "border-accent bg-accent-soft" : "border-border bg-surface"
      }`}
      onPress={onPress}
    >
      <Text
        className={`text-[13px] font-semibold ${
          isSelected ? "text-accent" : "text-foreground"
        }`}
      >
        {label}
      </Text>
    </Pressable>
  )
}

async function responseMessage(
  response: { text: () => Promise<string> },
  fallback: string
) {
  const responseText = await response.text()
  if (!responseText) return fallback
  try {
    const parsed = JSON.parse(responseText) as { message?: string }
    return typeof parsed.message === "string" ? parsed.message : fallback
  } catch {
    return fallback
  }
}
