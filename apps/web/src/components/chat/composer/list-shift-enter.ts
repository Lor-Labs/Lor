import { Extension } from "@tiptap/react"

// Enter sends, so Shift+Enter is the new line. In a list the new line is the
// next item, and Shift+Enter on an empty item ends the list, like Slack.
export const ListShiftEnter = Extension.create({
  name: "listShiftEnter",
  // Ahead of HardBreak, which also binds Shift-Enter.
  priority: 101,
  addKeyboardShortcuts() {
    return {
      "Shift-Enter": () =>
        this.editor.isActive("listItem") &&
        (this.editor.commands.splitListItem("listItem") ||
          this.editor.commands.liftListItem("listItem")),
    }
  },
})
