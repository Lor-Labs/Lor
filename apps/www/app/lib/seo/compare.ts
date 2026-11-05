import type { SeoPage } from "@/app/lib/seo/types"

// Lor's side of every comparison table. Keep in step with built features
// (reference/positioning.md capability boundaries).
const LOR = {
  what: "A shared workspace where your team works with AI in sessions next to channel chat",
  where:
    "In sessions under a channel. Anyone who can see the channel can open a session, type in it and continue it",
  actions:
    "Built-in connectors (GitHub, Linear, Notion, Attio, Datadog, CloudWatch, Better Stack) plus any MCP server or HTTP API you add",
  approvals:
    "Per-tool approval rules. A person approves before the action runs",
  schedule:
    "Loops run sessions on a schedule. Webhooks and connector events can start work",
  code: "Code sessions with repository files and diffs. People commit and push with their own GitHub account. Fork and rewind",
  computer:
    "Every session has its own sandbox to run code and produce files like reports, spreadsheets and charts",
  memory:
    "Searches the team's chat, earlier sessions and connected tools, and shows where it found things",
  openSource: "Yes, AGPL-3.0",
  controls: "Custom roles and approval rules. No SAML SSO or SCIM yet",
  price: "Private beta. [Join the waitlist](/#early-access)",
}

const CHECKED_ON = "2026-11-05"

const slack: SeoPage = {
  slug: "slack",
  label: "Lor vs Slack",
  title: "Lor vs Slack: shared AI sessions vs AI inside team chat",
  metaTitle: "Lor vs Slack for AI agents (2026) | Lor",
  description:
    "Slack adds AI to your team chat. Lor gives AI work its own shared sessions next to the chat. Pricing, AI features and when to use each.",
  published: CHECKED_ON,
  checkedOn: CHECKED_ON,
  intro: [
    "Slack is where many teams talk, and it now ships a lot of AI: summaries, AI search, Slackbot as a personal agent, MCP support and Slack Code channels for coding agents. Lor is a different shape of product. Channel chat stays between people, and AI work happens in shared sessions next to the chat, where the whole team can follow it, step in and approve what it does.",
    "This page compares the two honestly, including where Slack is the better choice. You don't have to give up Slack to use Lor.",
  ],
  summary: [
    "Slack is a team chat app with AI added on top. Business+ ($15 per user per month paid yearly) adds Slackbot, Slack's personal AI agent, along with AI search and recaps.",
    "Lor is built around AI work. Each piece of work is a session that anyone in the channel can open, add to and continue, with the channel's tools, instructions and memory already loaded.",
    "Slack leads on maturity: a huge app directory, SAML SSO, SCIM, data residency and enterprise compliance. Lor is in private beta and has none of the enterprise identity features yet.",
    "Lor leads on doing shared work with AI: scheduled runs, per-tool approvals, a sandbox per session, code sessions with personal GitHub commits, and open source code.",
    "You don't have to choose. Keep Slack for conversation and use Lor for the work you want the team and AI to do together.",
  ],
  sections: [
    {
      id: "comparison",
      heading: "Lor and Slack side by side",
      blocks: [
        {
          type: "table",
          columns: ["", "Lor", "Slack"],
          rows: [
            [
              "What it is",
              LOR.what,
              "A team chat app with channels, huddles, canvases and lists, plus built-in AI",
            ],
            [
              "Where AI work happens",
              LOR.where,
              "Slackbot is a personal AI agent. Agents and apps post into channels and threads",
            ],
            [
              "Acting in other tools",
              LOR.actions,
              "Slackbot can use tools from installed apps that include an MCP server. Large app directory",
            ],
            [
              "Approvals",
              LOR.approvals,
              "Depends on the app or agent you install",
            ],
            [
              "Scheduled work",
              LOR.schedule,
              "Workflow Builder with AI steps on Business+",
            ],
            [
              "Code",
              LOR.code,
              "Slack Code opens a temporary channel with diffs and previews when you mention a partner coding agent",
            ],
            [
              "Agent computer",
              LOR.computer,
              "Provided by the partner agent, if any",
            ],
            [
              "Memory and search",
              LOR.memory,
              "AI search across Slack. Enterprise search across connected apps on Enterprise+",
            ],
            ["Open source", LOR.openSource, "No"],
            [
              "Enterprise controls",
              LOR.controls,
              "SAML SSO and SCIM on Business+. DLP, legal holds and audit logs on Enterprise+",
            ],
            [
              "Price",
              LOR.price,
              "Free, Pro $7.25, Business+ $15 per user per month paid yearly. Enterprise+ by quote",
            ],
          ],
        },
      ],
    },
    {
      id: "pricing",
      heading: "What Slack's AI costs",
      blocks: [
        {
          type: "p",
          text: "Slack groups its AI by plan. The prices below are per user per month from Slack's pricing page.",
        },
        {
          type: "table",
          columns: ["Plan", "Paid monthly", "Paid yearly", "AI included"],
          rows: [
            ["Free", "$0", "$0", "No AI features"],
            [
              "Pro",
              "$8.75",
              "$7.25",
              "Basic AI: conversation and huddle summaries, third-party AI assistant apps",
            ],
            [
              "Business+",
              "$18",
              "$15",
              "Advanced AI: Slackbot, AI search, daily recaps, file summaries, AI steps in workflows",
            ],
            [
              "Enterprise+",
              "Contact sales",
              "Contact sales",
              "Everything above plus enterprise search across connected apps",
            ],
          ],
        },
        {
          type: "p",
          text: "Third-party agents in Slack, such as Claude Tag or coding agents in Slack Code channels, bill separately through their own vendors. Lor is in private beta, so we don't list a price here yet.",
        },
      ],
    },
    {
      id: "difference",
      heading: "The real difference: where the work lives",
      blocks: [
        {
          type: "p",
          text: "In Slack, AI work shows up as messages. A summary lands in a thread, an agent replies in a channel, a coding agent gets a temporary channel that archives when the work is done. That's convenient when the job is small. When the job is a week of account research, an incident review or a feature, the work competes with every other message in the stream.",
        },
        {
          type: "p",
          text: "Lor separates the two. People talk in the channel. Work with AI happens in a session that sits next to the channel and stays there:",
        },
        {
          type: "list",
          items: [
            "Start a session from the channel, or from any chat message with that message attached. Nothing posts into the chat.",
            "The session reads like a document: Lor's answers, the files it made, what it read and cited.",
            "Anyone in the channel can open it, type in it and steer the next step. Teammates can talk to each other inside the session too, and Lor reads that as context.",
            "When the result is ready, someone shares it into the chat as one message.",
            "Sessions stay searchable after they're done, so the reasoning behind a decision doesn't scroll away.",
          ],
        },
      ],
    },
    {
      id: "when-slack",
      heading: "When Slack is the right call",
      blocks: [
        {
          type: "list",
          items: [
            "You need enterprise identity and compliance today: SAML SSO, SCIM, data residency, legal holds, DLP or HIPAA support.",
            "Your workflows depend on Slack's app directory or on Slack Connect channels with customers and partners.",
            "The AI you want is mostly catching up: summaries, recaps and search over what people already wrote.",
            "You've standardized on a coding agent that already integrates with Slack Code, and quick, short-lived code channels fit how you work.",
          ],
        },
      ],
    },
    {
      id: "when-lor",
      heading: "When Lor is the better fit",
      blocks: [
        {
          type: "list",
          items: [
            "You want AI work the whole team can see and pick up, instead of answers pasted from private chats.",
            "You have recurring jobs, like weekly account research, an error review or a product digest, that should run on a schedule with people approving the risky steps.",
            "You want each project's instructions, tools and memory set up once for everyone, not per person.",
            "You want code work to stay in the same place as the discussion that led to it, with people committing under their own GitHub accounts.",
            "You care about being able to read the code: Lor is open source under AGPL-3.0.",
          ],
        },
      ],
    },
    {
      id: "together",
      heading: "Using Lor and Slack together",
      blocks: [
        {
          type: "p",
          text: "Lor doesn't ask you to move your team chat. Start with one project and the people on it. Keep talking in Slack, and bring the work you'd otherwise do in private AI chats into a Lor channel. If the work produces something the wider company needs, share the result back to Slack.",
        },
        {
          type: "p",
          text: "Lor can't read your Slack messages yet. If that matters to you, tell us when you [join the waitlist](/#early-access).",
        },
      ],
    },
  ],
  faqs: [
    {
      question: "Is Lor a Slack alternative?",
      answer:
        "For AI work, yes. For company-wide chat, not necessarily. Lor has channels, but its focus is the work your team does with AI. You can start by running one project in Lor and keep Slack for everything else. See [Slack alternatives for AI agents](/blog/slack-alternative-for-ai-agents) for the wider picture.",
    },
    {
      question: "Does Slack have AI agents?",
      answer:
        "Yes. Business+ includes Slackbot, which Slack describes as a personal AI agent, and Slackbot can use tools from installed apps that include an MCP server. Third-party agents like Claude Tag join channels, and Slack Code opens code channels for partner coding agents.",
    },
    {
      question: "How much does Slack AI cost?",
      answer:
        "Pro ($7.25 per user per month paid yearly) includes basic AI like summaries. Business+ ($15 paid yearly) adds Slackbot, AI search and recaps. Enterprise+ is priced by quote.",
    },
    {
      question: "Can Lor post into Slack?",
      answer:
        "Lor can call any HTTP API or MCP server you add, including ones that post to Slack, with an approval rule if you want a person to check first. Lor can't read Slack history yet.",
    },
    {
      question: "Does Lor have SSO?",
      answer:
        "Not yet. Lor has custom roles and per-tool approval rules, but no SAML SSO or SCIM. If you need those today, Slack Business+ or Enterprise+ covers them.",
    },
    {
      question: "Is Lor open source?",
      answer:
        "Yes. The code is on [GitHub](https://github.com/Lor-Labs/Lor) under the AGPL-3.0 license.",
    },
  ],
  sources: [
    { label: "Slack pricing", url: "https://slack.com/pricing" },
    { label: "Slackbot", url: "https://slack.com/features/slackbot" },
    {
      label: "Guide to Model Context Protocol in Slack",
      url: "https://slack.com/help/articles/48855576908307-Guide-to-Model-Context-Protocol-in-Slack",
    },
    {
      label: "Slack Code: channels for agents",
      url: "https://slack.com/blog/news/slack-code-channels-for-agents",
    },
    {
      label: "Introducing Claude Tag (Anthropic)",
      url: "https://www.anthropic.com/news/introducing-claude-tag",
    },
    {
      label: "Lor source code (AGPL-3.0)",
      url: "https://github.com/Lor-Labs/Lor",
    },
  ],
  related: [
    "/blog/slack-alternative-for-ai-agents",
    "/compare/microsoft-teams",
    "/compare/claude-team",
  ],
}

const microsoftTeams: SeoPage = {
  slug: "microsoft-teams",
  label: "Lor vs Microsoft Teams",
  title: "Lor vs Microsoft Teams: shared AI sessions vs Copilot in the suite",
  metaTitle: "Lor vs Microsoft Teams and Copilot (2026) | Lor",
  description:
    "Microsoft Teams brings Copilot into Microsoft 365. Lor gives your team shared AI sessions with your own tools. Pricing, agents and when to use each.",
  published: CHECKED_ON,
  checkedOn: CHECKED_ON,
  intro: [
    "Microsoft Teams comes with Microsoft 365, and Copilot is now part of that bundle: Copilot Chat at no extra cost, a paid Copilot license for Microsoft 365 apps, and agents like Facilitator for meetings and Channel Agent for channels. If your company runs on Outlook, SharePoint and Word, that's a strong default.",
    "Lor is built for a different job: AI work a small team does together, in shared sessions next to the chat, with the tools the team already uses, like GitHub, Linear, Notion and Attio. This page compares the two.",
  ],
  summary: [
    "Teams is chat, meetings and calling inside Microsoft 365. Copilot adds AI that works across Microsoft 365 data, mostly as a personal assistant.",
    "Microsoft 365 Business Standard with Teams is $14 per user per month paid yearly. The Copilot Business add-on starts at $18 per user per month paid yearly, and some agent features bill in Copilot Credits on top.",
    "Lor puts AI work in sessions the whole channel can join, with connectors, approvals, schedules and a sandbox for each session.",
    "Teams wins on meetings, calling, Microsoft 365 integration and compliance. Lor wins on shared, steerable AI work across non-Microsoft tools and code.",
  ],
  sections: [
    {
      id: "comparison",
      heading: "Lor and Microsoft Teams side by side",
      blocks: [
        {
          type: "table",
          columns: ["", "Lor", "Microsoft Teams with Copilot"],
          rows: [
            [
              "What it is",
              LOR.what,
              "Chat, meetings and calling in Microsoft 365, with Copilot across the suite",
            ],
            [
              "Where AI work happens",
              LOR.where,
              "Copilot is a personal assistant. Facilitator works in meetings, and Channel Agent (preview) works in channels",
            ],
            [
              "Acting in other tools",
              LOR.actions,
              "Copilot connectors for grounding. Copilot Studio agents can use MCP tools",
            ],
            [
              "Approvals",
              LOR.approvals,
              "Depends on how the agent is built in Copilot Studio",
            ],
            [
              "Scheduled work",
              LOR.schedule,
              "Copilot Studio agents and Power Automate flows",
            ],
            [
              "Code",
              LOR.code,
              "Copilot's Code feature bills in Copilot Credits on top of the seat",
            ],
            [
              "Agent computer",
              LOR.computer,
              "Cowork agents that run for hours bill in Copilot Credits on top of the seat",
            ],
            [
              "Memory and search",
              LOR.memory,
              "Grounded in Microsoft 365 data: mail, files, meetings and chats",
            ],
            ["Open source", LOR.openSource, "No"],
            [
              "Enterprise controls",
              LOR.controls,
              "Entra ID, Purview retention and eDiscovery, Intune and Defender on Business Premium",
            ],
            [
              "Price",
              LOR.price,
              "Business Standard $14, plus Copilot Business from $18, per user per month paid yearly",
            ],
          ],
        },
      ],
    },
    {
      id: "pricing",
      heading: "What Teams and Copilot cost",
      blocks: [
        {
          type: "p",
          text: "Microsoft raised Microsoft 365 business prices on July 1, 2026. Prices below are per user per month, paid yearly, from Microsoft's pages. Business plans cap at 300 users.",
        },
        {
          type: "table",
          columns: ["Plan", "Price", "AI included"],
          rows: [
            [
              "Microsoft 365 Business Basic (with Teams)",
              "$7.00",
              "Copilot Chat, grounded in web data",
            ],
            [
              "Microsoft 365 Business Standard (with Teams)",
              "$14.00",
              "Copilot Chat, grounded in web data",
            ],
            [
              "Microsoft 365 Business Premium (with Teams)",
              "$22.00",
              "Copilot Chat, plus security and device management",
            ],
            [
              "Microsoft 365 Copilot Business add-on",
              "From $18.00 ($25.20 paid monthly)",
              "Copilot in Microsoft 365 apps and agents in Teams",
            ],
          ],
        },
        {
          type: "p",
          text: "Microsoft also bills some newer Copilot features, such as Cowork, Code and Autopilot, in Copilot Credits on top of the seat. Lor is in private beta, so we don't list a price here yet.",
        },
      ],
    },
    {
      id: "difference",
      heading: "The real difference: whose tools, whose work",
      blocks: [
        {
          type: "p",
          text: "Copilot is strongest inside Microsoft 365. It reads your mail, files, meetings and chats and helps each person with their own work there. Its channel and meeting agents are a step toward shared work, but they live inside the Microsoft stack and need a Copilot license.",
        },
        {
          type: "p",
          text: "Lor is for teams whose work lives across tools like GitHub, Linear, Notion, Attio and Datadog. Each channel connects the tools that project needs, and every session in the channel starts with them. The work happens in sessions anyone in the channel can open:",
        },
        {
          type: "list",
          items: [
            "One person starts the work, another adds context, someone else picks it up the next day.",
            "Approval rules make writes and sends wait for the right person.",
            "Loops run the same job every week, and the team can follow each run.",
            "Code sessions keep a change, its diff and the discussion behind it together.",
          ],
        },
      ],
    },
    {
      id: "when-teams",
      heading: "When Microsoft Teams is the right call",
      blocks: [
        {
          type: "list",
          items: [
            "Your company runs on Outlook, SharePoint, OneDrive and Word, and the AI mostly needs that data.",
            "You need meetings, calling and phone systems in the same app.",
            "You need Entra ID, Purview retention, eDiscovery and device management today.",
            "You already pay for Microsoft 365 and Copilot Chat covers what your team asks AI for.",
          ],
        },
      ],
    },
    {
      id: "when-lor",
      heading: "When Lor is the better fit",
      blocks: [
        {
          type: "list",
          items: [
            "Your team's work lives in GitHub, Linear, Notion, Attio or other tools outside Microsoft 365.",
            "You want AI work that teammates can join and continue, not a personal assistant per person.",
            "You have recurring jobs that should run on a schedule with people approving the risky steps.",
            "You're a small team that wants to start with one project without changing company-wide tools.",
            "You want software you can read: Lor is open source under AGPL-3.0.",
          ],
        },
      ],
    },
  ],
  faqs: [
    {
      question: "Is Lor a Microsoft Teams alternative?",
      answer:
        "For shared AI work, yes. For meetings, calling and Microsoft 365 integration, no. You can keep Teams for meetings and company chat and use Lor for one project's AI work.",
    },
    {
      question: "Does Microsoft Teams have AI agents?",
      answer:
        "Yes, with a Microsoft 365 Copilot license. Facilitator takes notes and answers in meetings, and Channel Agent (in preview) works in standard channels. Copilot Studio lets you build custom agents, including ones that use MCP tools.",
    },
    {
      question: "How much does Copilot cost for small businesses?",
      answer:
        "Microsoft lists the Copilot Business add-on from $18 per user per month paid yearly, on top of a Microsoft 365 business plan. Some agent features bill in Copilot Credits on top of that.",
    },
    {
      question: "Can Lor connect to Microsoft 365?",
      answer:
        "Lor doesn't have a built-in Microsoft 365 connector. You can add an MCP server or HTTP API for the Microsoft tools you need, with approval rules on anything that writes.",
    },
    {
      question: "Does Lor have SSO?",
      answer:
        "Not yet. Lor has custom roles and per-tool approval rules, but no SAML SSO or SCIM.",
    },
  ],
  sources: [
    {
      label: "Microsoft 365 packaging and pricing updates (2026)",
      url: "https://www.microsoft.com/en-us/licensing/news/2026-m365-packaging-pricing-updates",
    },
    {
      label: "Microsoft 365 Copilot business pricing",
      url: "https://www.microsoft.com/en-us/copilot/pricing/business",
    },
    {
      label: "Copilot and AI agents in Microsoft Teams",
      url: "https://learn.microsoft.com/en-us/microsoftteams/copilot-ai-agents-overview",
    },
    {
      label: "Set up Channel Agent in Teams",
      url: "https://learn.microsoft.com/en-us/microsoftteams/set-up-channel-agent-teams",
    },
    {
      label: "Extend Copilot Studio agents with MCP",
      url: "https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp",
    },
    {
      label: "Evolution of the Copilot pricing model",
      url: "https://techcommunity.microsoft.com/blog/microsoft-copilot-blog/evolution-of-the-copilot-pricing-model/4559416",
    },
  ],
  related: [
    "/compare/slack",
    "/blog/ai-agent-platforms-for-small-teams",
    "/blog/what-is-a-shared-ai-workspace",
  ],
}

const chatgptBusiness: SeoPage = {
  slug: "chatgpt-business",
  label: "Lor vs ChatGPT Business",
  title: "Lor vs ChatGPT Business (formerly ChatGPT Team)",
  metaTitle: "Lor vs ChatGPT Business (ChatGPT Team) | Lor",
  description:
    "ChatGPT Business gives each person a strong assistant. Lor gives the team shared AI sessions with approvals and schedules. Pricing and when to use each.",
  published: CHECKED_ON,
  checkedOn: CHECKED_ON,
  intro: [
    "ChatGPT Business, the plan OpenAI used to call ChatGPT Team, is a strong choice for giving everyone a capable assistant. Every seat includes ChatGPT, ChatGPT Work and Codex, and the plan adds shared projects, workspace agents, scheduled tasks and custom MCP apps.",
    "Lor solves a narrower problem: AI work the team should do together. Instead of each person working in their own chats and sharing results, the work happens in sessions the whole channel can open, steer and approve.",
  ],
  summary: [
    "ChatGPT Business costs $20 per user per month paid yearly ($25 monthly) for a Standard seat, or $100 ($125 monthly) for a Premium seat with higher limits.",
    "It's built around the individual. Joining a team in ChatGPT doesn't share personal chats or app connections, though projects, workspace agents and team tasks can be shared.",
    "Lor is built around the team. Sessions live in channels, every teammate can type in them, and the channel's tools and instructions apply to everyone.",
    "You can use both: ChatGPT for personal work, Lor for the work the team should share.",
  ],
  sections: [
    {
      id: "comparison",
      heading: "Lor and ChatGPT Business side by side",
      blocks: [
        {
          type: "table",
          columns: ["", "Lor", "ChatGPT Business"],
          rows: [
            [
              "What it is",
              LOR.what,
              "OpenAI's assistant for teams, with ChatGPT, ChatGPT Work and Codex in every seat",
            ],
            [
              "Where AI work happens",
              LOR.where,
              "Each person's own chats. Projects, workspace agents and team tasks can be shared",
            ],
            [
              "Acting in other tools",
              LOR.actions,
              "Apps and custom MCP connectors with write actions. Admins add them, each person connects their own accounts",
            ],
            [
              "Approvals",
              LOR.approvals,
              "Confirmations inside each person's chat",
            ],
            [
              "Scheduled work",
              LOR.schedule,
              "Scheduled tasks and workspace agents on a schedule",
            ],
            [
              "Code",
              LOR.code,
              "Codex runs coding tasks against your repositories",
            ],
            [
              "Agent computer",
              LOR.computer,
              "Code execution and a built-in browser",
            ],
            [
              "Memory and search",
              LOR.memory,
              "Personal memory and company knowledge from connected apps",
            ],
            ["Open source", LOR.openSource, "No"],
            [
              "Enterprise controls",
              LOR.controls,
              "SAML SSO and SOC 2 Type 2 on Business. SCIM, RBAC and data residency on Enterprise",
            ],
            [
              "Price",
              LOR.price,
              "$20 Standard or $100 Premium per user per month paid yearly. 2 seat minimum for most teams",
            ],
          ],
        },
      ],
    },
    {
      id: "pricing",
      heading: "What ChatGPT Business costs",
      blocks: [
        {
          type: "table",
          columns: ["Seat", "Paid monthly", "Paid yearly", "Included"],
          rows: [
            ["Standard", "$25", "$20", "ChatGPT, ChatGPT Work and Codex"],
            [
              "Premium",
              "$125",
              "$100",
              "The same, with higher usage and no five-hour limit",
            ],
          ],
        },
        {
          type: "p",
          text: "You can mix seat types and buy workspace credits for usage beyond the included limits. OpenAI says plan usage will share one limit across ChatGPT and Codex starting in December. Lor is in private beta, so we don't list a price here yet.",
        },
      ],
    },
    {
      id: "difference",
      heading: "The real difference: personal assistant vs shared session",
      blocks: [
        {
          type: "p",
          text: "ChatGPT's unit of work is a person's chat. That's why it's so good for individual thinking, and why teams end up pasting results into their chat app. Shared projects help with files and instructions, and workspace agents let a team reuse a setup, but the live back-and-forth usually happens in one person's tab.",
        },
        {
          type: "p",
          text: "Lor's unit of work is a session in a channel. Picture a customer bug:",
        },
        {
          type: "list",
          items: [
            "Someone raises it in the channel. Another teammate starts a session from that message, so Lor sees it.",
            "Lor reads the customer notes and the code. A third teammate joins the session and adds a requirement Lor didn't know about.",
            "Someone continues the session into code, reviews the diff with the team, and commits under their own GitHub account.",
            "A month later, someone asks why the behavior changed, and Lor points back to the session.",
          ],
        },
        {
          type: "p",
          text: "Every step happened in one place the team could see. Nobody had to copy context between tabs.",
        },
      ],
    },
    {
      id: "when-chatgpt",
      heading: "When ChatGPT Business is the right call",
      blocks: [
        {
          type: "list",
          items: [
            "You mainly want every person to have a strong assistant for their own work.",
            "You want Codex included in every seat.",
            "You need SAML SSO today.",
            "Your team is happy sharing results rather than working in the same session.",
          ],
        },
      ],
    },
    {
      id: "when-lor",
      heading: "When Lor is the better fit",
      blocks: [
        {
          type: "list",
          items: [
            "The same context gets rebuilt in five private chats, and results reach the team as pasted text.",
            "You want teammates to step into AI work halfway, not just read the output.",
            "You want connected tools and instructions set up once per project for everyone.",
            "You want a person to approve specific actions, like a CRM update or an email, before they happen.",
            "You want the code: Lor is open source under AGPL-3.0.",
          ],
        },
      ],
    },
  ],
  faqs: [
    {
      question: "Is ChatGPT Team the same as ChatGPT Business?",
      answer:
        "Yes. OpenAI renamed the ChatGPT Team plan to ChatGPT Business. Standard seats are $20 per user per month paid yearly or $25 paid monthly.",
    },
    {
      question: "Can teammates share ChatGPT chats?",
      answer:
        "Teams in ChatGPT can share projects, workspace agents and recurring team tasks. Personal chats and app connections stay with the person who made them.",
    },
    {
      question: "Can I use Lor and ChatGPT together?",
      answer:
        "Yes. Keep a personal AI plan for individual work and use Lor for work the team should do together.",
    },
    {
      question: "Does Lor have SSO?",
      answer: "Not yet. Lor has custom roles and per-tool approval rules.",
    },
  ],
  sources: [
    {
      label: "ChatGPT Business overview (OpenAI Help Center)",
      url: "https://help.openai.com/en/articles/8792828-chatgpt-business-overview",
    },
    {
      label: "ChatGPT Business pricing",
      url: "https://openai.com/business/chatgpt-pricing/",
    },
    {
      label: "Developer mode and MCP apps in ChatGPT",
      url: "https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt",
    },
    {
      label: "ChatGPT workspace agents",
      url: "https://help.openai.com/en/articles/20001143-chatgpt-workspace-agents-for-enterprise-and-business",
    },
    {
      label: "ChatGPT Business release notes",
      url: "https://help.openai.com/en/articles/11391654-chatgpt-business-release-notes",
    },
  ],
  related: [
    "/compare/claude-team",
    "/blog/what-is-a-shared-ai-workspace",
    "/blog/ai-agent-platforms-for-small-teams",
  ],
}

const claudeTeam: SeoPage = {
  slug: "claude-team",
  label: "Lor vs Claude Team",
  title: "Lor vs Claude Team: shared sessions for the whole team",
  metaTitle: "Lor vs Claude Team plan (2026) | Lor",
  description:
    "Claude Team gives each person Claude, Claude Code and shared projects. Lor gives the team shared AI sessions, approvals and schedules. When to use each.",
  published: CHECKED_ON,
  checkedOn: CHECKED_ON,
  intro: [
    "Anthropic's Claude Team plan gives each person Claude, Claude Code and Cowork, with shared projects, connectors and memory. Claude Tag, in beta on Team, adds a shared Claude to Slack channels.",
    "Lor is a shared workspace built around team AI work. It's also a place your Claude subscription can work: teammates can run Claude Code sessions in Lor on their own Claude subscription, next to Lor's own agent.",
  ],
  summary: [
    "Claude Team costs $20 per seat per month paid yearly ($25 monthly) for Standard, or $100 ($125 monthly) for Premium, for teams of 2 to 150.",
    "Claude's chats are personal, with shared projects for files and instructions. Claude Tag brings a shared Claude into Slack channels, billed by usage.",
    "Lor puts the work itself in shared sessions next to the channel chat, with the channel's tools, approval rules and schedules.",
    "These fit together. Keep Claude for personal work and run Claude Code sessions on your subscription inside Lor where the team can follow along.",
  ],
  sections: [
    {
      id: "comparison",
      heading: "Lor and Claude Team side by side",
      blocks: [
        {
          type: "table",
          columns: ["", "Lor", "Claude Team"],
          rows: [
            [
              "What it is",
              LOR.what,
              "Anthropic's plan for teams: Claude, Claude Code and Cowork for each seat",
            ],
            [
              "Where AI work happens",
              LOR.where,
              "Each person's chats, with shared projects. Claude Tag works in Slack channels",
            ],
            [
              "Acting in other tools",
              LOR.actions,
              "Connectors and remote MCP. Owners add custom connectors, each member connects their own account",
            ],
            [
              "Approvals",
              LOR.approvals,
              "Confirmations inside each person's chat",
            ],
            [
              "Scheduled work",
              LOR.schedule,
              "Claude Tag can schedule its own tasks",
            ],
            [
              "Code",
              LOR.code,
              "Claude Code in every seat. Claude Tag can open pull requests through a GitHub App",
            ],
            [
              "Agent computer",
              LOR.computer,
              "Code execution, and a sandbox for Claude Tag",
            ],
            [
              "Memory and search",
              LOR.memory,
              "Memory, and enterprise search on Team",
            ],
            ["Open source", LOR.openSource, "No"],
            [
              "Enterprise controls",
              LOR.controls,
              "SSO on Team. SCIM, audit logs and custom retention on Enterprise",
            ],
            [
              "Price",
              LOR.price,
              "$20 Standard or $100 Premium per seat per month paid yearly. Claude Tag bills by usage",
            ],
          ],
        },
      ],
    },
    {
      id: "pricing",
      heading: "What Claude Team costs",
      blocks: [
        {
          type: "table",
          columns: ["Seat", "Paid monthly", "Paid yearly", "Included"],
          rows: [
            [
              "Standard",
              "$25",
              "$20",
              "Claude, Claude Code and Cowork, projects, connectors, memory, SSO",
            ],
            ["Premium", "$125", "$100", "The same, with five times the usage"],
          ],
        },
        {
          type: "p",
          text: "The Team plan is for teams of 2 to 150, and seat types can be mixed. Claude Tag bills the organization by usage rather than per seat. Lor is in private beta, so we don't list a price here yet.",
        },
      ],
    },
    {
      id: "difference",
      heading: "The real difference: a shared place for the work",
      blocks: [
        {
          type: "p",
          text: "Claude is excellent at the work itself. The question for a team is where that work lives. In Claude, it's in one person's chat or in Slack threads with Claude Tag. In Lor, it's a session in a channel that anyone in the channel can open, type in and continue.",
        },
        {
          type: "list",
          items: [
            "The channel holds the instructions, connected tools and memory, so every session starts with the team's context.",
            "Teammates can talk to each other inside a session, and the agent reads that as context on its next turn.",
            "Approval rules hold writes and sends until the right person says yes.",
            "Code sessions show files and diffs to everyone in the session, and people commit and push under their own GitHub accounts. Lor doesn't commit for you.",
            "Fork a session to try another approach, or rewind to an earlier turn with the code and conversation together.",
          ],
        },
      ],
    },
    {
      id: "when-claude",
      heading: "When Claude Team is the right call",
      blocks: [
        {
          type: "list",
          items: [
            "You want each person to have Claude, Claude Code and Cowork for their own work.",
            "Your team lives in Slack, and a shared Claude in your channels through Claude Tag covers what you need.",
            "You need SSO today.",
          ],
        },
      ],
    },
    {
      id: "when-lor",
      heading: "When Lor is the better fit",
      blocks: [
        {
          type: "list",
          items: [
            "You want AI work to have its own place next to the chat, not mixed into the message stream.",
            "You want teammates to step into a running session and steer it.",
            "You want recurring jobs to run on a schedule with approvals and a visible history of each run.",
            "You want Lor's agent and Claude Code in the same shared workspace.",
            "You want the code: Lor is open source under AGPL-3.0.",
          ],
        },
      ],
    },
  ],
  faqs: [
    {
      question: "Can I use my Claude subscription in Lor?",
      answer:
        "Yes. Teammates with a Claude subscription can run Claude Code sessions in Lor on that subscription. Those sessions sit in the channel like any other, so the team can follow along.",
    },
    {
      question: "What is Claude Tag?",
      answer:
        "Claude Tag is Anthropic's shared Claude for Slack channels, in beta on Team and Enterprise plans. Each channel gets one Claude with its own memory, and the organization pays by usage.",
    },
    {
      question: "How much is Claude Team?",
      answer:
        "Standard seats are $20 per month paid yearly or $25 paid monthly. Premium seats are $100 paid yearly or $125 paid monthly, with five times the usage.",
    },
    {
      question: "Does Lor have SSO?",
      answer: "Not yet. Lor has custom roles and per-tool approval rules.",
    },
  ],
  sources: [
    { label: "Claude pricing", url: "https://claude.com/pricing" },
    {
      label: "Get started with custom connectors using remote MCP",
      url: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
    },
    {
      label: "Introducing Claude Tag (Anthropic)",
      url: "https://www.anthropic.com/news/introducing-claude-tag",
    },
    {
      label: "What is Claude Tag? (Claude Help Center)",
      url: "https://support.claude.com/en/articles/15594475-what-is-claude-tag",
    },
  ],
  related: [
    "/compare/chatgpt-business",
    "/compare/slack",
    "/blog/what-is-a-shared-ai-workspace",
  ],
}

export const COMPARISONS: SeoPage[] = [
  slack,
  microsoftTeams,
  chatgptBusiness,
  claudeTeam,
]
