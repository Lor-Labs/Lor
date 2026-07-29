import { Button } from "@repo/ui/components/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/ui/components/input-group"
import { Eye, EyeOff } from "lucide-react"
import { type ComponentProps, useState } from "react"

type PasswordInputProps = Omit<ComponentProps<"input">, "type">

export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <InputGroup>
      <InputGroupInput type={visible ? "text" : "password"} {...props} />
      <InputGroupAddon align="inline-end">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? (
            <EyeOff className="size-4 text-muted-foreground" />
          ) : (
            <Eye className="size-4 text-muted-foreground" />
          )}
        </Button>
      </InputGroupAddon>
    </InputGroup>
  )
}
