import type { SeoPage } from "@/app/lib/seo/types"

const sharedWorkspace: SeoPage = {
  slug: "what-is-a-shared-ai-workspace",
  label: "What is a shared AI workspace?",
  title: "What is a shared AI workspace?",
  metaTitle: "What is a shared AI workspace? | Lor",
  description:
    "A shared AI workspace keeps a team's AI work where teammates can see it, join it and approve it. What it is, what it needs and how to start.",
  published: "2026-11-05",
  checkedOn: "2026-11-05",
  intro: [
    "A lot of team thinking now happens with AI. The trouble is where that work lives: in one person's chat history, on one person's account. The team sees a pasted answer or a screenshot, and the reasoning behind it stays in a private tab.",
    "A shared AI workspace moves that work into a place the team shares. This guide explains what that means in practice, what to look for, and how to try it without moving your whole team.",
  ],
  summary: [
    "A shared AI workspace is a place where a team's conversations, tools and AI work live together, so anyone on the team can see an AI session, add context, take it over or approve what it does.",
    "It differs from personal AI plans, where each chat belongs to one person, and from AI added to a chat app, where the AI mostly summarizes and searches messages.",
    "The parts that matter: shared sessions, team context set up once, tools the AI can use with approvals, work on a schedule, and real outputs like files and code changes next to the conversation.",
    "You don't need to replace your team chat to start. Pick one project and the people working on it.",
  ],
  sections: [
    {
      id: "definition",
      heading: "A working definition",
      blocks: [
        {
          type: "p",
          text: "A shared AI workspace is software where AI work belongs to the team, not to one person. When someone starts a piece of work with AI, such as researching an account, investigating a bug or drafting a launch plan, that work happens somewhere teammates can open. They can read what the AI looked at, add what it missed, continue it later and decide what goes out.",
        },
        {
          type: "p",
          text: "Three things set it apart from a personal AI chat:",
        },
        {
          type: "list",
          items: [
            "Visibility: the work sits in a shared place, like a channel or project, not in one person's sidebar.",
            "Joint control: more than one person can steer the same piece of work, and the right person approves actions before they happen.",
            "Shared context: the team connects its tools and writes its instructions once, and every session uses them.",
          ],
        },
      ],
    },
    {
      id: "why",
      heading: "Why private AI chats stop working for teams",
      blocks: [
        {
          type: "p",
          text: "Personal AI chat is great for one person's thinking. It gets awkward once the work belongs to the team:",
        },
        {
          type: "list",
          items: [
            "Results reach the team as pasted text. The sources, the dead ends and the reasons for a decision stay behind.",
            "Each person rebuilds the same context. Five people explain the same customer, codebase or process to five separate chats.",
            "Nobody can step in halfway. If an AI draft needs a teammate's knowledge, the work has to be copied somewhere else first.",
            "Approvals happen out of band. When AI can change a CRM record or send a message, the team needs a clear point where the right person says yes.",
            "Knowledge leaves with people. When someone changes roles or leaves, their chat history goes with them.",
          ],
        },
      ],
    },
    {
      id: "checklist",
      heading: "What a shared AI workspace needs",
      blocks: [
        {
          type: "p",
          text: "Use this as a checklist when you compare tools, including Lor.",
        },
        {
          type: "table",
          columns: ["Capability", "What to check"],
          rows: [
            [
              "Shared sessions",
              "Can a teammate open a session someone else started, type in it and continue the work?",
            ],
            [
              "Team context, set up once",
              "Are connected tools and instructions set per team or project, or does every person connect their own?",
            ],
            [
              "Tools with approvals",
              "Can the AI act in your tools, and can you require a person to approve specific actions first?",
            ],
            [
              "Work on a schedule",
              "Can a job run every Monday, or when an event arrives, with the team able to follow along?",
            ],
            [
              "Real outputs",
              "Does the work produce files, data and code changes you can review, not only chat replies?",
            ],
            [
              "Memory",
              "Can the AI find what the team decided last month, and show where it found it?",
            ],
            [
              "Permissions",
              "Can you control who sees which work and who can approve what?",
            ],
          ],
        },
      ],
    },
    {
      id: "options",
      heading: "Three ways teams share AI work today",
      blocks: [
        {
          type: "table",
          columns: ["Approach", "Examples", "Good at", "Gaps for shared work"],
          rows: [
            [
              "Team plans of AI assistants",
              "[ChatGPT Business](/compare/chatgpt-business), [Claude Team](/compare/claude-team)",
              "Strong personal assistants, shared projects and admin billing",
              "Chats stay personal by default. Teammates rarely work inside the same live session",
            ],
            [
              "AI inside team chat",
              "[Slack](/compare/slack), [Microsoft Teams](/compare/microsoft-teams)",
              "Summaries and search across the messages your team already writes",
              "The AI lives in the message stream, so long pieces of work get lost in history",
            ],
            [
              "A shared AI workspace",
              "Lor",
              "Sessions the whole team can join, with tools, approvals and schedules set per project",
              "Newer products. Fewer integrations and enterprise controls than the big suites",
            ],
          ],
        },
        {
          type: "p",
          text: "These approaches mix well. You can keep a personal AI plan for individual work and their chat app for conversation, and use a shared workspace for the work the team should do together. We go deeper in [AI agent platforms for small teams](/blog/ai-agent-platforms-for-small-teams).",
        },
      ],
    },
    {
      id: "how-lor-works",
      heading: "How Lor does it",
      blocks: [
        {
          type: "p",
          text: "Lor is a shared workspace for your team and AI. It splits the two kinds of conversation that usually get mixed together:",
        },
        {
          type: "list",
          items: [
            "Channel chat is people talking to people. Lor never posts there.",
            "Lor works in sessions that sit next to the chat, listed under their channel. Anyone who can see a session can type in it, add context or pick it up later.",
            "A channel holds the project's instructions, connected tools, files and memory, so every session in it starts with the same context.",
            "Lor connects to GitHub, Linear, Notion, Attio, Datadog, CloudWatch and Better Stack, and to any MCP server or HTTP API you add. Through MCP it can reach email, CRMs and most other tools your team uses.",
            "Per-tool approval rules decide which actions need a person to say yes before they run.",
            "Loops run a session on a schedule, like every Monday morning. Webhooks and connector events can start work too.",
            "Each session has its own computer, so Lor can produce real files: reports, spreadsheets, charts.",
            "Code sessions open a repository, show files and diffs, and let a person review, commit and push with their own GitHub account. You can fork a session to try another approach, or rewind to an earlier turn.",
            "Lor is open source under the AGPL-3.0 license.",
          ],
        },
      ],
    },
    {
      id: "start",
      heading: "How to start without moving your team",
      blocks: [
        {
          type: "p",
          text: "Changing team chat is the biggest reason teams avoid new tools, so don't start there. Keep your chat app. Pick one piece of work the team repeats, such as weekly account research, an error review or a product digest, and set up one channel for it with the people involved.",
        },
        {
          type: "list",
          items: [
            "Write the channel's instructions the way you'd brief a new teammate.",
            "Connect only the tools that job needs, and require approval for anything that writes or sends.",
            "Run it by hand a few times with the team watching, then put it on a schedule.",
            "After two weeks, check two things: did it save time, and did more than one person use it?",
          ],
        },
      ],
    },
  ],
  faqs: [
    {
      question:
        "Is a shared AI workspace the same as a team plan for ChatGPT or Claude?",
      answer:
        "Not quite. Team plans give each person a strong assistant plus shared projects and admin controls, but most chats stay with the person who started them. A shared AI workspace puts the session itself in a shared place, so teammates work inside the same piece of work.",
    },
    {
      question: "Do we need to stop using Slack or Microsoft Teams?",
      answer:
        "No. Lor works alongside your existing team chat. Start with one project and the people on it.",
    },
    {
      question: "Can the AI take actions in our tools?",
      answer:
        "Yes. Lor uses its built-in connectors, plus any MCP server or HTTP API you add. Approval rules decide which actions need a person to approve them first.",
    },
    {
      question: "Who can see a session?",
      answer:
        "Sessions live in a channel, so the people who can see the channel can see and join its sessions. Roles and permissions control who can change settings and approve actions.",
    },
    {
      question: "How do we try Lor?",
      answer:
        "Lor is in private beta. [Join the waitlist](/#early-access) and we'll email you when your team's invite is ready.",
    },
  ],
  sources: [
    {
      label: "Lor source code (AGPL-3.0)",
      url: "https://github.com/Lor-Labs/Lor",
    },
  ],
  related: [
    "/blog/ai-agent-platforms-for-small-teams",
    "/blog/slack-alternative-for-ai-agents",
    "/compare/chatgpt-business",
  ],
}

const slackAlternative: SeoPage = {
  slug: "slack-alternative-for-ai-agents",
  label: "Slack alternatives for AI agents",
  title: "Slack alternatives for AI agents: four ways to set up your team",
  metaTitle: "Slack alternatives for AI agents (2026 guide) | Lor",
  description:
    "Looking for a Slack alternative for AI agents? Four real options, what each costs, and how to choose without moving your whole team.",
  published: "2026-11-05",
  checkedOn: "2026-11-05",
  intro: [
    "People search for a Slack alternative for AI agents for different reasons. Some want agents that do real work, not just summaries. Some find that agent replies drown out the people in their channels. Some want the team to see and approve what an agent does before it happens.",
    "Most of these problems don't need a new chat app. This guide walks through four setups, what each costs and when each makes sense, including the ones where you keep Slack.",
  ],
  summary: [
    "Option 1: keep Slack and add an agent inside it, like Slackbot on Business+, Claude Tag or a coding agent in Slack Code.",
    "Option 2: keep Slack and give AI work its own shared workspace next to it, like Lor.",
    "Option 3: give each person a team AI plan, like ChatGPT Business or Claude Team, and share results in Slack.",
    "Option 4: move to a suite with AI built in, like Microsoft Teams with Copilot, if your company already runs on Microsoft 365.",
    "Decide by asking three questions: do you need to replace chat, who needs to see and approve the AI's work, and does the work involve code?",
  ],
  sections: [
    {
      id: "questions",
      heading: "Three questions that decide it",
      blocks: [
        {
          type: "list",
          items: [
            "Do you need to replace your chat, or give AI work a better home? Moving a team's chat is expensive. If people are happy talking in Slack, the answer is usually to change where the AI work happens, not where people talk.",
            "Who needs to see and approve the AI's work? If one person uses AI for their own tasks, a personal assistant is enough. If the work belongs to the team, like account research, incident reviews or customer replies, you need a shared place and approvals.",
            "Does the work involve code? Coding agents need a repository, a sandbox and a way for people to review diffs and commit. Check how each option handles that.",
          ],
        },
      ],
    },
    {
      id: "agent-in-slack",
      heading: "Option 1: keep Slack, add an agent inside it",
      blocks: [
        {
          type: "p",
          text: "Slack has moved fast here. Business+ includes Slackbot, which Slack describes as a personal AI agent, and Slackbot can use tools from installed apps that include an MCP server. Anthropic's Claude Tag puts a shared Claude in your channels, with memory per channel. Slack Code opens a temporary code channel with diffs and previews when you mention a partner coding agent.",
        },
        {
          type: "list",
          items: [
            "Good for: teams that live in Slack and want AI where the conversation already is.",
            "Watch for: agent work competes with people's messages, and long pieces of work get spread across threads. Each agent brings its own billing, permissions and approval model.",
          ],
        },
      ],
    },
    {
      id: "shared-workspace",
      heading: "Option 2: keep Slack, add a shared AI workspace",
      blocks: [
        {
          type: "p",
          text: "A shared AI workspace gives AI work its own place, next to your chat rather than inside it. [Lor](/compare/slack) works this way. People talk in channels. Work with AI happens in sessions listed under each channel, where anyone in the channel can open the session, add context, steer it and pick it up later.",
        },
        {
          type: "list",
          items: [
            "Each channel holds its own instructions, connected tools and memory, so the team sets them up once.",
            "Lor connects to GitHub, Linear, Notion, Attio, Datadog, CloudWatch and Better Stack, plus any MCP server or HTTP API you add.",
            "Approval rules hold writes and sends until the right person approves. Loops run work on a schedule.",
            "Code sessions show files and diffs, and people commit and push with their own GitHub accounts.",
            "Good for: small teams that want shared, steerable AI work without moving their chat.",
            "Watch for: Lor is in private beta, can't read Slack history yet, and has no SAML SSO or SCIM.",
          ],
        },
      ],
    },
    {
      id: "team-plans",
      heading: "Option 3: team AI plans, results shared in Slack",
      blocks: [
        {
          type: "p",
          text: "[ChatGPT Business](/compare/chatgpt-business) and [Claude Team](/compare/claude-team) give each person a strong assistant with shared projects, connectors and admin controls. ChatGPT's workspace agents can be added to Slack channels, and Claude Tag brings Claude into Slack.",
        },
        {
          type: "list",
          items: [
            "Good for: making everyone faster at their own work, with coding agents (Codex or Claude Code) included in the seat.",
            "Watch for: most of the back-and-forth stays in one person's chat. The team sees the pasted result, not how it was reached.",
          ],
        },
      ],
    },
    {
      id: "suite",
      heading: "Option 4: move to a suite with AI built in",
      blocks: [
        {
          type: "p",
          text: "If your company already runs on Outlook, SharePoint and Word, [Microsoft Teams with Copilot](/compare/microsoft-teams) keeps chat, meetings, files and AI in one bill. With a Copilot license, Teams adds Facilitator for meetings and Channel Agent (in preview) for channels.",
        },
        {
          type: "list",
          items: [
            "Good for: Microsoft 365 companies that need compliance, meetings and calling in one place.",
            "Watch for: Copilot is strongest with Microsoft 365 data. Work that lives in GitHub, Linear or a CRM needs custom agents, and some agent features bill in Copilot Credits on top of the seat.",
          ],
        },
      ],
    },
    {
      id: "costs",
      heading: "What each option costs",
      blocks: [
        {
          type: "p",
          text: "Per user per month, paid yearly, from each vendor's pricing page.",
        },
        {
          type: "table",
          columns: ["Setup", "What you pay", "Notes"],
          rows: [
            [
              "Slack Business+ with Slackbot",
              "$15",
              "Third-party agents like Claude Tag bill separately",
            ],
            [
              "Slack plus Lor",
              "Slack's plan plus Lor",
              "Lor is in private beta, so there's no public price yet",
            ],
            [
              "ChatGPT Business",
              "$20 Standard, $100 Premium",
              "Includes Codex. Usually a 2 seat minimum",
            ],
            [
              "Claude Team",
              "$20 Standard, $100 Premium",
              "Includes Claude Code. Teams of 2 to 150",
            ],
            [
              "Microsoft 365 Business Standard plus Copilot Business",
              "$14 plus from $18",
              "Some agent features bill in Copilot Credits",
            ],
          ],
        },
      ],
    },
    {
      id: "trial",
      heading: "What to test in a two-week trial",
      blocks: [
        {
          type: "p",
          text: "Whichever option you pick, test it on one real, recurring job with three or four people, not on a demo prompt.",
        },
        {
          type: "list",
          items: [
            "Can a teammate pick up work someone else started with the AI, without copying anything?",
            "Can you require approval before the AI writes to a tool or sends a message, and is it clear who approves?",
            "Can the job run on a schedule, and can the team see what each run did?",
            "When someone asks why a decision was made, can the AI find the work that led to it?",
            "After two weeks: did it save time, and did more than one person use it?",
          ],
        },
      ],
    },
  ],
  faqs: [
    {
      question: "What is the best Slack alternative for AI agents?",
      answer:
        "It depends on what you're replacing. If you want to keep talking in Slack but give AI work a shared home, use a shared AI workspace like Lor next to it. If you need everything in one Microsoft 365 bill, Teams with Copilot fits. If you just want agents in your channels, Slackbot or Claude Tag work inside Slack.",
    },
    {
      question: "Can AI agents work inside Slack?",
      answer:
        "Yes. Slackbot on Business+ is Slack's own agent, third-party agents like Claude Tag join channels, and Slack Code opens channels for partner coding agents.",
    },
    {
      question: "Do I have to leave Slack to use Lor?",
      answer:
        "No. Lor works alongside your existing chat. Start with one project and the people on it.",
    },
    {
      question: "Is Lor free?",
      answer:
        "Lor is in private beta and doesn't have a public price yet. [Join the waitlist](/#early-access) to get an invite.",
    },
  ],
  sources: [
    { label: "Slack pricing", url: "https://slack.com/pricing" },
    {
      label: "Slack Code: channels for agents",
      url: "https://slack.com/blog/news/slack-code-channels-for-agents",
    },
    {
      label: "Introducing Claude Tag (Anthropic)",
      url: "https://www.anthropic.com/news/introducing-claude-tag",
    },
    {
      label: "ChatGPT Business overview (OpenAI Help Center)",
      url: "https://help.openai.com/en/articles/8792828-chatgpt-business-overview",
    },
    { label: "Claude pricing", url: "https://claude.com/pricing" },
    {
      label: "Microsoft 365 Copilot business pricing",
      url: "https://www.microsoft.com/en-us/copilot/pricing/business",
    },
    {
      label: "Microsoft 365 packaging and pricing updates (2026)",
      url: "https://www.microsoft.com/en-us/licensing/news/2026-m365-packaging-pricing-updates",
    },
  ],
  related: [
    "/compare/slack",
    "/blog/ai-agent-platforms-for-small-teams",
    "/blog/what-is-a-shared-ai-workspace",
  ],
}

const smallTeamPlatforms: SeoPage = {
  slug: "ai-agent-platforms-for-small-teams",
  label: "AI agent platforms for small teams",
  title: "AI agent platforms for small teams: how to choose",
  metaTitle: "AI agent platforms for small teams (2026 guide) | Lor",
  description:
    "How a 3 to 20 person team should choose an AI agent platform: the four main types, what they cost, and the questions to ask before you commit.",
  published: "2026-11-05",
  checkedOn: "2026-11-05",
  intro: [
    "Small teams adopt AI fast and unevenly. One person has a great setup, another pastes results into chat, and nobody can see what the agents did last week. Picking a platform is less about the smartest model and more about where the team's AI work lives.",
    "This guide is for teams of roughly 3 to 20 people. It sorts the options into four types, says what each is good at, and lists the questions worth asking before you commit.",
  ],
  summary: [
    "Team plans of AI assistants (ChatGPT Business, Claude Team) make each person faster and cost about $20 per user per month paid yearly.",
    "AI in your chat suite (Slack, Microsoft Teams with Copilot) adds summaries, search and agents where people already talk.",
    "Shared AI workspaces (Lor) give AI work its own shared place, with tools, approvals and schedules set per project.",
    "Agent builders and workflow tools suit fixed pipelines but need someone to build and maintain them.",
    "For most small teams the first question is: does this work belong to one person, or to the team?",
  ],
  sections: [
    {
      id: "needs",
      heading: "What small teams need from an agent platform",
      blocks: [
        {
          type: "p",
          text: "Small teams don't have an IT department to configure agents, and everyone wears several hats. That changes the checklist:",
        },
        {
          type: "list",
          items: [
            "Set up once: connected tools and instructions should apply to the whole team or project, not be redone by every person.",
            "Shared by default: anyone should be able to see what an agent did and continue the work.",
            "Approvals: a person should approve anything that writes to a customer-facing tool or sends a message.",
            "Recurring work: weekly research, error reviews and digests should run on a schedule without someone remembering to start them.",
            "Your tools: the agent needs to reach where your work is, such as GitHub, Linear, Notion or your CRM, not just documents.",
            "Low lock-in: you should be able to start with one project and leave without migrating your whole company.",
          ],
        },
      ],
    },
    {
      id: "types",
      heading: "The four types of agent platform",
      blocks: [
        {
          type: "table",
          columns: ["Type", "Examples", "Best at", "Watch for"],
          rows: [
            [
              "Team plans of AI assistants",
              "[ChatGPT Business](/compare/chatgpt-business), [Claude Team](/compare/claude-team)",
              "Making each person faster, with coding agents in the seat",
              "Work mostly stays in personal chats",
            ],
            [
              "AI in your chat suite",
              "[Slack](/compare/slack), [Microsoft Teams](/compare/microsoft-teams)",
              "Summaries, search and agents where people already talk",
              "Agent work mixes into the message stream. Agents often bill separately",
            ],
            [
              "Shared AI workspaces",
              "Lor",
              "Team AI work in shared sessions with approvals and schedules",
              "Newer products with fewer enterprise controls",
            ],
            [
              "Agent builders and workflow tools",
              "Microsoft Copilot Studio and similar",
              "Fixed, repeatable pipelines",
              "Someone has to build and maintain each flow",
            ],
          ],
        },
      ],
    },
    {
      id: "team-plans",
      heading: "Team plans of AI assistants",
      blocks: [
        {
          type: "p",
          text: "ChatGPT Business and Claude Team both cost $20 per user per month paid yearly for a Standard seat, or $100 for a Premium seat with more usage. Both include a coding agent (Codex or Claude Code), shared projects, connectors and MCP support. ChatGPT adds workspace agents that can run on a schedule, and Claude adds Claude Tag, a shared Claude for Slack channels billed by usage.",
        },
        {
          type: "p",
          text: "These plans are the right default for individual productivity. Their limit for teams is that the live work usually happens in one person's chat, and each member connects their own accounts to the team's tools.",
        },
      ],
    },
    {
      id: "chat-suites",
      heading: "AI in your chat suite",
      blocks: [
        {
          type: "p",
          text: "Slack Business+ ($15 per user per month paid yearly) includes Slackbot, AI search and recaps, and Slackbot can use tools from apps that include an MCP server. Microsoft 365 Business Standard ($14) includes Teams and Copilot Chat, and the Copilot Business add-on (from $18) adds Copilot across the apps plus agents in Teams.",
        },
        {
          type: "p",
          text: "This is the least disruptive option if you're already on one of these suites. The tradeoff is that AI work lives in the message stream, where long pieces of work are hard to follow and easy to lose.",
        },
      ],
    },
    {
      id: "shared-workspaces",
      heading: "Shared AI workspaces",
      blocks: [
        {
          type: "p",
          text: "A [shared AI workspace](/blog/what-is-a-shared-ai-workspace) gives AI work its own place next to the chat. In Lor, channels hold a project's people, instructions, connected tools and memory. Lor works in sessions listed under the channel. Anyone in the channel can open a session, type in it, steer it and continue it later.",
        },
        {
          type: "list",
          items: [
            "Connectors for GitHub, Linear, Notion, Attio, Datadog, CloudWatch and Better Stack, plus any MCP server or HTTP API you add.",
            "Per-tool approval rules, custom roles and Loops that run sessions on a schedule.",
            "A sandbox for every session, so Lor can run code and produce files like reports and spreadsheets.",
            "Code sessions with files and diffs, where people commit and push under their own GitHub accounts.",
            "Open source under AGPL-3.0.",
          ],
        },
        {
          type: "p",
          text: "The tradeoff: Lor is in private beta, has fewer integrations than the big suites, and doesn't have SAML SSO or SCIM yet.",
        },
      ],
    },
    {
      id: "builders",
      heading: "Agent builders and workflow tools",
      blocks: [
        {
          type: "p",
          text: "Agent builders like Microsoft Copilot Studio let you design an agent or workflow step by step and connect it to tools, including through MCP. They work well when the process is fixed and someone owns it. For a small team, the cost is the building and upkeep: when the process changes, someone has to edit the flow.",
        },
      ],
    },
    {
      id: "questions",
      heading: "Questions to ask before you commit",
      blocks: [
        {
          type: "list",
          items: [
            "If I start a piece of work with the agent, can a teammate open it and continue it?",
            "Who sets up the connected tools: each person, or once for the team?",
            "Which actions can require approval, and who approves them?",
            "Can work run on a schedule, and can we see the history of each run?",
            "How does the agent handle code: does it work in a sandbox, and who commits?",
            "What does it cost at our size, including usage on top of seats?",
            "Can we start with one project and leave easily if it doesn't work?",
          ],
        },
      ],
    },
  ],
  faqs: [
    {
      question: "What is an AI agent platform?",
      answer:
        "Software that lets AI agents do work for you, not just answer questions: read and write in your tools, run code, follow instructions and work on a schedule. For teams, the important part is where that work lives and who can see and steer it.",
    },
    {
      question: "What's the cheapest way for a small team to start?",
      answer:
        "Use the AI already in your current tools for a few weeks and note which jobs repeat. Then pick one recurring job and trial a platform built for shared work on it, with three or four people.",
    },
    {
      question: "Do we need a developer to set up agents?",
      answer:
        "Not for team plans, chat suites or Lor. In Lor you write a channel's instructions in plain language and connect tools from settings. Agent builders usually need someone comfortable designing workflows.",
    },
    {
      question: "How do we keep agents from doing something wrong?",
      answer:
        "Require approval for anything that writes to a tool or sends a message, start with read-only connectors, and review the first few scheduled runs together. In Lor, approval rules are set per tool.",
    },
    {
      question: "How do we try Lor?",
      answer:
        "Lor is in private beta. [Join the waitlist](/#early-access) and we'll email you when your team's invite is ready.",
    },
  ],
  sources: [
    {
      label: "ChatGPT Business overview (OpenAI Help Center)",
      url: "https://help.openai.com/en/articles/8792828-chatgpt-business-overview",
    },
    {
      label: "ChatGPT workspace agents",
      url: "https://help.openai.com/en/articles/20001143-chatgpt-workspace-agents-for-enterprise-and-business",
    },
    { label: "Claude pricing", url: "https://claude.com/pricing" },
    { label: "Slack pricing", url: "https://slack.com/pricing" },
    {
      label: "Microsoft 365 Copilot business pricing",
      url: "https://www.microsoft.com/en-us/copilot/pricing/business",
    },
    {
      label: "Extend Copilot Studio agents with MCP",
      url: "https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp",
    },
    {
      label: "Lor source code (AGPL-3.0)",
      url: "https://github.com/Lor-Labs/Lor",
    },
  ],
  related: [
    "/blog/what-is-a-shared-ai-workspace",
    "/blog/slack-alternative-for-ai-agents",
    "/compare/claude-team",
  ],
}

export const GUIDES: SeoPage[] = [
  slackAlternative,
  smallTeamPlatforms,
  sharedWorkspace,
]
