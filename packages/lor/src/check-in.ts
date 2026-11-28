// The agent's check-in (reference/agents-and-chats.md, decision 26):
// automatic and hidden. About every CHECK_IN_MINUTES the worker's sweep wakes
// an agent's own conversation when something waits unread in a channel it is
// in and nothing else is about to wake it, so a quiet agent's check-ins cost
// nothing. It is not a Loop and has no setting.

export const CHECK_IN_MINUTES = 15

export const CHECK_IN_NOTE =
  "Your regular check-in. Look over what came in since you last looked, in every channel you are in: messages that weren't addressed to you and events that waited. Act or answer only where something needs you or the team would want you to step in; otherwise end the turn quietly. Nobody asked just now: when you do speak, speak as if you noticed it yourself."
