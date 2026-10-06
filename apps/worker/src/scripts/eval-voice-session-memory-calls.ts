// Sample calls for eval-voice-session-memory.ts, written to read like
// machine-transcribed speech: fillers, back-channels, false starts, audio
// trouble, misheard names, and topic changes that nobody announces.
//
// A call is a list of topic blocks of [speaker, text] lines, plus gaps
// (uncaptured minutes). A block boundary is an expected section start.
// `optional` marks a block whose boundary is defensible either way: a section
// may start there, but merging it into the previous block also passes.
export type Block =
  | {
      topic: string
      optional?: boolean
      lines: [speaker: string, text: string][]
    }
  | { gap: number }
export type Call = { name: string; expect: string; blocks: Block[] }

export const CALLS: Call[] = [
  {
    name: "product-sync",
    expect: "4 sections: opening chat, pricing, Google sign-up bug, hiring",
    blocks: [
      {
        topic: "opening",
        lines: [
          ["Jacob", "Hey. Hey hey."],
          ["Alice", "Hi."],
          ["Jacob", "Is Bob, um, is Bob coming or"],
          ["Alice", "He said two minutes. He's getting coffee I think."],
          [
            "Jacob",
            "Okay. Did you, did you end up going to that thing on Saturday? The, uh, the market thing.",
          ],
          [
            "Alice",
            "No, it rained the whole, like the entire weekend. I just stayed in and finished that book I was telling you about. The generation ship one.",
          ],
          ["Jacob", "Oh nice. Was the ending any good?"],
          [
            "Alice",
            "It was fine. It kind of, it kind of falls apart in the last hundred pages but, yeah.",
          ],
          ["Bob", "Hey, sorry. Sorry I'm late."],
          ["Jacob", "No you're good. We were just, yeah. Okay."],
        ],
      },
      {
        topic: "pricing",
        lines: [
          [
            "Jacob",
            "So, um. I guess the main thing I wanted to get through today is pricing, because the launch page goes up Thursday and we keep saying we'll settle the tiers and then we don't.",
          ],
          ["Alice", "Yeah."],
          [
            "Jacob",
            "So right now it's twenty a seat and then the free tier is five seats. And I don't, I don't love five.",
          ],
          [
            "Alice",
            "I mean, I've said this before but five is way too generous. Like a team of five can run on the free tier forever, they never, they just never convert.",
          ],
          [
            "Bob",
            "The numbers kind of back that up actually. I pulled it yesterday, of the workspaces under five seats, it's like two percent that upgraded last quarter. Two point something.",
          ],
          ["Jacob", "Two percent."],
          ["Bob", "Yeah."],
          ["Jacob", "Okay so what do we, three? Do we go to three?"],
          [
            "Alice",
            "Three feels right to me. It's still, you know, a founder and two people can actually try it properly, but you can't run a real team on it.",
          ],
          ["Bob", "Sorry, one sec, my dog is losing it. Go ahead."],
          ["Alice", "Ha. No, that's, that was basically it. Three seats."],
          [
            "Bob",
            "Okay, back. Um, what about annual? Do we, are we discounting annual at all?",
          ],
          [
            "Jacob",
            "I think we just do the standard two months free thing. It's easy to explain and nobody has to think about it.",
          ],
          ["Alice", "Mm-hmm."],
          ["Bob", "So like sixteen sixty-something a month effectively."],
          [
            "Jacob",
            "Yeah, whatever it comes out to, we don't have to show the per month number.",
          ],
          [
            "Alice",
            "Okay so, let me just say it back. Free tier goes to three seats, twenty a seat stays, annual is two months free. I'll update the launch page copy today.",
          ],
          ["Jacob", "Perfect."],
        ],
      },
      {
        topic: "onboarding",
        lines: [
          [
            "Jacob",
            "Okay. Um. What else. Oh, the Google thing. Bob, you said people signing up with Google are landing on an empty workspace?",
          ],
          [
            "Bob",
            "Yeah so, this is kind of a weird one. If you sign up with Google and then you skip the invite step, you land in a workspace with no channels at all. Just, nothing. Blank sidebar.",
          ],
          ["Alice", "Every Google sign-up or"],
          [
            "Bob",
            "No, only if you skip the invite step. Because the, um, the default channels get created in the invite handler for some reason. So if you skip it, you skip them.",
          ],
          ["Jacob", "Why would they be in the invite handler."],
          [
            "Bob",
            "I think it was just, whoever wrote it put it there because that's where the first member gets added. I don't think it was on purpose.",
          ],
          [
            "Alice",
            "Okay so that's just, move the channel creation into the workspace creation. That's like a, that's not a big change.",
          ],
          [
            "Bob",
            "Yeah. I'll do it today. There's eleven workspaces that are sitting empty right now, I'll backfill those too.",
          ],
          ["Jacob", "How do you know it's eleven?"],
          [
            "Bob",
            "I just queried for workspaces with zero channels. It's eleven, they're all from the last two weeks.",
          ],
          [
            "Jacob",
            "Okay. Can you also put something in the signup flow check so it doesn't, so we catch it if it comes back.",
          ],
          ["Bob", "Yep. Will do."],
        ],
      },
      {
        topic: "hiring",
        lines: [
          [
            "Jacob",
            "Cool. And then, last thing, I know we're kind of over but, hiring. We've got the two finalists for mobile.",
          ],
          ["Alice", "Priya and Marcus."],
          ["Jacob", "Yeah. Where are we."],
          [
            "Alice",
            "I really liked Priya. Her take-home was the only one that actually handled offline state. Like everybody else just, if the network dropped the app just died, and hers queued stuff and replayed it.",
          ],
          [
            "Bob",
            "I agree the take-home was great. I thought Marcus was stronger in the system design round though. Like noticeably. I'd want to see Priya talk through architecture before we, before we decide.",
          ],
          ["Alice", "That's fair."],
          [
            "Jacob",
            "Okay, so let's do one more call with Priya, just architecture, and then we decide by Friday. Does that work?",
          ],
          ["Bob", "Works for me."],
          ["Alice", "Yeah, I'll set it up. Wednesday probably."],
          ["Jacob", "Cool. Okay, that's it. Thanks guys."],
        ],
      },
    ],
  },
  {
    name: "one-long-topic",
    expect:
      "1 section: moving the database to Neon, worked through from several angles",
    blocks: [
      {
        topic: "migration",
        lines: [
          [
            "Jacob",
            "Okay so this is just the, uh, the database thing. Whether we actually move off Railway Postgres to Neon this month or we keep kicking it.",
          ],
          ["Alice", "Right."],
          [
            "Jacob",
            "Alice you've been the one pushing for it so, why don't you, yeah.",
          ],
          [
            "Alice",
            "So the main reason for me is branching. Like every preview deploy could get its own database branch instead of all of them sharing staging and stepping on each other.",
          ],
          [
            "Alice",
            "Because right now if two people have previews up and one runs a migration, the other one's just broken.",
          ],
          ["Bob", "Yeah, that happened to me Tuesday."],
          [
            "Bob",
            "There's also the cost side. The Railway bill for Postgres went up like forty percent since we added the embedding tables.",
          ],
          ["Jacob", "Forty?"],
          [
            "Bob",
            "Yeah, the, um, the vectors are just big. The attachment chunks table alone is most of it.",
          ],
          ["Jacob", "And what does Neon cost for us. Like our size."],
          [
            "Bob",
            "I ran it through their calculator on the scale plan. It's roughly, it's about the same as now, but the preview branches scale to zero when nobody's hitting them. So it actually gets cheaper the more previews we have, which is backwards from now.",
          ],
          ["Alice", "Right."],
          [
            "Alice",
            "The thing I'm actually worried about is PG vector. Like we lean on half vec and the H N S W indexes pretty hard for search.",
          ],
          [
            "Bob",
            "So I checked that. Neon has PG vector and the version is new enough for half vec. The indexes would have to be rebuilt after the restore though, you can't just carry them over.",
          ],
          ["Jacob", "How long is a rebuild on the, on the big table."],
          [
            "Bob",
            "About twenty minutes for attachment chunks. The others are seconds. Like, nothing.",
          ],
          [
            "Alice",
            "And during those twenty minutes search still works right, it's just slow. It falls back to a, a sequential scan.",
          ],
          [
            "Bob",
            "Yeah, slow but correct. And keyword search isn't touched at all, that's a different index.",
          ],
          ["Jacob", "Sorry, you cut out. Say the last part again?"],
          [
            "Bob",
            "Keyword search isn't affected. It's a different index, it comes over fine.",
          ],
          ["Jacob", "Okay. And downtime for the actual cutover."],
          [
            "Bob",
            "Depends how we do it. If we set up logical replication first, the cutover is like two minutes of read-only mode. If we don't, it's a dump and restore and that's, I don't know, forty minutes maybe. Could be more.",
          ],
          [
            "Alice",
            "Replication is more setup work but forty minutes of downtime on a weekday is, I mean, people are in calls. That's not great.",
          ],
          ["Jacob", "Yeah no, let's do replication."],
          [
            "Jacob",
            "What's the, um, what's the rollback story. If something's wrong after we cut over.",
          ],
          [
            "Bob",
            "We keep Railway up in read-only for a week. If we have to roll back we point the connection string back at it and replay whatever got written to Neon in between.",
          ],
          ["Alice", "Replay from where though."],
          [
            "Bob",
            "From the Neon side. We'd have the, there's a log. It'd be manual but it's doable for a week of writes.",
          ],
          [
            "Alice",
            "Okay. Oh, and extensions. PG trigram is the other one we installed by hand, we'd need that too.",
          ],
          ["Bob", "Good call. Neon has it, I'll add it to the checklist."],
          [
            "Jacob",
            "Timing. Can we get this done before the launch on the twentieth or is that insane.",
          ],
          [
            "Bob",
            "I think so. Setup this week, let replication run over the weekend, cut over Tuesday morning. That still leaves us a week of buffer before the twentieth.",
          ],
          [
            "Alice",
            "I'm okay with that if we do a dry run on a copy first. Like actually do the whole thing once on a throwaway.",
          ],
          ["Bob", "Yeah, I was going to anyway."],
          [
            "Jacob",
            "Okay. So, decision. We go to Neon, logical replication, cutover next Tuesday, Railway stays read-only for a week as the rollback, and Bob does a dry run first.",
          ],
          ["Alice", "Yep."],
          ["Bob", "Sounds good."],
        ],
      },
    ],
  },
  {
    name: "topic-comes-back",
    expect:
      "3 sections: the 0.7 release date, the Acme escalation, the release date again",
    blocks: [
      {
        topic: "release",
        lines: [
          [
            "Jacob",
            "Okay so, the release. Is the twentieth still, is that still real for 0.7?",
          ],
          [
            "Alice",
            "Honestly it depends on the voice stuff. If approvals in calls slip then the twentieth is tight.",
          ],
          ["Jacob", "How tight."],
          [
            "Alice",
            "Like, it's doable but there's no room. If anything else comes up we miss it.",
          ],
          [
            "Bob",
            "Mobile's ready either way. The test flight build went out yesterday, it's fine.",
          ],
          ["Jacob", "Okay."],
          [
            "Jacob",
            "Actually hold on, hold that thought, I want to do Acme first because it might, it might change the answer.",
          ],
        ],
      },
      {
        topic: "acme",
        lines: [
          ["Alice", "Yeah okay. So, Acme."],
          [
            "Alice",
            "They escalated again this morning. Their admin, the, um, Dana, she says Laura answered a question in a public channel using something that was from a private channel.",
          ],
          ["Bob", "Lor did?"],
          ["Alice", "Yeah."],
          [
            "Bob",
            "That shouldn't be, like that shouldn't be possible. Search is scoped to the channel it's answering in. It can't see private stuff from a public channel.",
          ],
          [
            "Alice",
            "So I looked at it, I spent like an hour on it. The private channel got moved under a public category last week. And the category's audience won.",
          ],
          ["Jacob", "Oh."],
          ["Jacob", "So it's the category rule, it's not a search bug."],
          [
            "Alice",
            "Right, it did exactly what we built. But from their side it looks like a leak, and honestly I kind of get it. We should warn people when they move a private channel under a public category.",
          ],
          [
            "Bob",
            "I can add a confirm dialog for that. Like, hey, this will make the channel visible to everyone, are you sure.",
          ],
          ["Jacob", "Yeah do that."],
          [
            "Bob",
            "And I'll write back to Dana today and walk through what happened. I'd rather it come from me than support.",
          ],
          ["Alice", "Yeah, please. She's pretty worked up."],
        ],
      },
      {
        topic: "release",
        lines: [
          [
            "Jacob",
            "Okay so, back to the release. The Acme dialog is small, does that change the date at all?",
          ],
          [
            "Alice",
            "No. The dialog is an afternoon. The voice approvals are the real risk, that hasn't changed.",
          ],
          [
            "Bob",
            "Then I'd say we commit to the twentieth, and if approvals aren't merged by the fifteenth we just ship without them. They go in the next one.",
          ],
          ["Alice", "I can live with that."],
          [
            "Jacob",
            "Okay. Twentieth. Approvals get cut if they're not in by the fifteenth. Done.",
          ],
        ],
      },
    ],
  },
  {
    name: "incident-with-gap",
    expect:
      "2 sections: the incident, from first alert through rollback with an uncaptured stretch, then the postmortem",
    blocks: [
      {
        topic: "incident",
        lines: [
          [
            "Bob",
            "Okay, so, the API's throwing five hundreds. It's about a third of requests, started around ten forty.",
          ],
          ["Jacob", "A third. Is it everything or"],
          [
            "Bob",
            "Mostly the message routes. Hang on. Yeah, it's a connection pool timeout. From the database.",
          ],
          ["Jacob", "Pool timeout."],
          ["Bob", "Yeah."],
          ["Alice", "Hey, sorry, I just saw the alert. What's going on?"],
          [
            "Bob",
            "Five hundreds on the API, pool timeouts on the message routes, since ten forty.",
          ],
          [
            "Alice",
            "We deployed the worker at ten thirty-five. That's, that can't be a coincidence. The new embedding backfill might be holding connections.",
          ],
          [
            "Bob",
            "Oh. Yeah. That lines up. The backfill opens a transaction per batch and the batches are, they're huge.",
          ],
          ["Jacob", "Can we just stop it? Stop the backfill job?"],
          ["Bob", "Trying. One sec."],
        ],
      },
      { gap: 4 },
      {
        topic: "incident",
        lines: [
          [
            "Bob",
            "Okay I'm back, sorry, I think my audio dropped. So stopping it didn't fully help. The pool's still saturated from the stuck transactions.",
          ],
          ["Jacob", "Still a third?"],
          ["Bob", "It's like twenty five percent now. Not great."],
          [
            "Alice",
            "Then we roll the worker back and restart it. That kills the transactions outright.",
          ],
          ["Jacob", "Do it. Roll back the worker to yesterday's build."],
          ["Bob", "Rolling back now."],
          ["Bob", "Okay. It's deploying."],
          ["Alice", "I'm watching the dashboard."],
          [
            "Bob",
            "Okay, error rate's dropping. It's, yeah, it's under one percent.",
          ],
          [
            "Alice",
            "Yeah, message routes look healthy on my end too. P fifty is back to normal.",
          ],
          ["Jacob", "Okay. Good. Phew."],
        ],
      },
      {
        topic: "postmortem",
        lines: [
          [
            "Jacob",
            "Okay, while we're all here. Let's do a postmortem. Alice can you own it?",
          ],
          [
            "Alice",
            "Yeah. I'll have it written up by Thursday. The fix is obvious, smaller batches, no long transactions in the backfill.",
          ],
          [
            "Bob",
            "We should also set a statement timeout on the worker's connections. Like, the worker should never be able to starve the API like that, regardless of what job it's running.",
          ],
          ["Alice", "Yeah, that's a good one."],
          [
            "Jacob",
            "Add that as an action item. And, um, can we get an alert on pool usage? Not just on error rate. We'd have seen this coming.",
          ],
          ["Bob", "Yeah, I'll add one."],
          ["Jacob", "Okay. Thanks everyone. Go get lunch."],
        ],
      },
    ],
  },
  {
    name: "standup",
    expect: "4 sections: three people's updates, then blockers",
    blocks: [
      {
        topic: "jacob-update",
        lines: [
          ["Jacob", "Okay, quick standup. I'll go first."],
          [
            "Jacob",
            "Voice channels. The after-call summaries are working now, I've got Lor posting the recap in the call chat. Today I'm on the search part, so making the transcripts show up in answers.",
          ],
          ["Alice", "Does that include the, um, the transcript links?"],
          [
            "Jacob",
            "Yeah, the citations will open the transcript at the right spot. That's the plan anyway.",
          ],
        ],
      },
      {
        topic: "alice-update",
        lines: [
          ["Alice", "Cool. Okay, me."],
          [
            "Alice",
            "Billing. The autumn webhook retries are fixed, that was the thing where we double-charged the one workspace. And I'm starting on the usage page.",
          ],
          ["Bob", "Is that per seat or per workspace?"],
          ["Alice", "Per workspace, with a per person breakdown underneath."],
          ["Bob", "Okay."],
        ],
      },
      {
        topic: "bob-update",
        lines: [
          ["Jacob", "Bob?"],
          ["Jacob", "Bob, you're muted."],
          [
            "Bob",
            "Sorry. Mobile. The call screen shows Lor's window now, so you can see the cards on your phone. Next is the call pill, so you can leave the screen without hanging up on everyone.",
          ],
          ["Alice", "Oh nice."],
        ],
      },
      {
        topic: "blockers",
        lines: [
          ["Jacob", "Cool. Any blockers?"],
          [
            "Alice",
            "I need someone to look at the webhook PR, it's been sitting since Monday.",
          ],
          ["Bob", "I'll take it. After lunch."],
          ["Alice", "Thank you."],
          ["Jacob", "Okay, that's it. Bye."],
        ],
      },
    ],
  },
  {
    name: "customer-onboarding",
    expect:
      "4 or 5 sections: intros (optional), Halvorsen's current setup, SSO and data requirements, pricing and pilot, next steps",
    blocks: [
      {
        topic: "intros",
        lines: [
          ["Jacob", "Hi, hey. Can you hear us okay?"],
          ["Dana", "Yeah, you're good. Can you hear me?"],
          ["Jacob", "Perfectly. Thanks for making time."],
          [
            "Dana",
            "Of course. Marcus is going to join too, he's our, he runs IT. He should be on in a sec.",
          ],
          ["Alice", "Great."],
          [
            "Marcus",
            "Hey, hello. Sorry, the link opened in the wrong browser.",
          ],
          ["Jacob", "No worries. Hi Marcus."],
          [
            "Jacob",
            "So, um, quickly, I'm Jacob, I'm one of the founders, and Alice runs product. We'll mostly just listen today. Dana, do you want to start with where things are at for you guys?",
          ],
        ],
      },
      {
        topic: "setup",
        optional: true,
        lines: [
          [
            "Dana",
            "Sure. So, Halvorsen is about a hundred and twenty people, mostly dispatch and ops, and then a small engineering team, maybe fifteen.",
          ],
          [
            "Dana",
            "We're on Teams for chat, which, you know. Nobody likes it but it came with the Office stuff.",
          ],
          ["Alice", "Mm-hmm."],
          [
            "Dana",
            "And the problem we actually have is that the dispatchers are asking the same questions over and over. Like where's the SOP for a damaged pallet, what's the cutoff for the Thursday run, that kind of thing. It all lives in a SharePoint nobody can find anything in.",
          ],
          [
            "Alice",
            "And is that, when you say asking, they're asking in chat? Or calling someone?",
          ],
          [
            "Dana",
            "Both. Mostly chat during the day, and then at night they call whoever's on. Which is usually me.",
          ],
          ["Jacob", "Ha. Okay."],
          [
            "Marcus",
            "And the engineering side, we've got about, uh, two hundred pages of internal docs in Notion that are, I'd say half of them are out of date.",
          ],
          ["Alice", "Right."],
          [
            "Dana",
            "So what we saw in the demo, where you can just ask Laura and it pulls from the docs and from past conversations, that's, honestly that's the whole pitch for us.",
          ],
          [
            "Alice",
            "Lor, yeah. And to be clear, it only answers from what's in the channel it's asked in, plus whatever's been connected. So it wouldn't pull from a private channel into a public one.",
          ],
          ["Dana", "Right, you mentioned that."],
        ],
      },
      {
        topic: "sso",
        lines: [
          [
            "Marcus",
            "So my stuff is going to be boring but I have to ask it. SSO. We're on Entra, formerly Azure AD. Do you support that?",
          ],
          [
            "Jacob",
            "We do SAML and OIDC, so Entra works. Setup's on our side right now, it's not self-serve yet, but it's like a half hour call.",
          ],
          ["Marcus", "And SCIM? For provisioning?"],
          [
            "Jacob",
            "Not yet. Honestly. It's on the list but I don't want to tell you a date.",
          ],
          [
            "Marcus",
            "Okay. That's, I appreciate the honesty. We can live with manual provisioning for a hundred and twenty people for a while. We'd want it eventually.",
          ],
          ["Jacob", "Noted."],
          [
            "Marcus",
            "Where's the data? Like physically. We have customers in the EU and legal's going to ask.",
          ],
          [
            "Jacob",
            "US right now. US east. We can talk about an EU region if that becomes a blocker but I'd want to know it's a real blocker first.",
          ],
          [
            "Marcus",
            "I'll check with legal. I think it's fine since it's internal chat and not customer data, but I'll check.",
          ],
          [
            "Marcus",
            "And the transcripts. The call recording stuff. Is that, can we turn that off?",
          ],
          [
            "Alice",
            "Transcripts are per workspace, so yes, you can turn them off entirely. If they're on, only the people in the call see them live, and everyone in the call can see the recap after.",
          ],
          ["Marcus", "Okay. Good."],
        ],
      },
      {
        topic: "pricing",
        lines: [
          [
            "Dana",
            "Okay, so, the awkward part. Pricing. We saw twenty a seat on the site.",
          ],
          [
            "Jacob",
            "Yeah, twenty a seat, and that pools the Lor usage across the workspace. So you're not, like, nobody runs out individually.",
          ],
          [
            "Dana",
            "At a hundred and twenty people that's, what, twenty-nine thousand a year. Which is, I mean, it's more than Teams, because Teams is free for us.",
          ],
          ["Jacob", "Right."],
          [
            "Dana",
            "Is there, like, do all hundred and twenty need a seat? The dispatchers mostly just read.",
          ],
          [
            "Alice",
            "Right now everyone who's in the workspace is a seat. We've talked about a lighter seat for people who only read, but it doesn't exist today.",
          ],
          [
            "Jacob",
            "What I can do is, for an annual contract at that size, we can do a discount. I'd have to come back with the number but it'd be meaningful, not like five percent.",
          ],
          ["Dana", "Okay."],
          [
            "Dana",
            "And a pilot. Could we do, say, the engineering team and the dispatch leads first? Like thirty people for a month?",
          ],
          [
            "Jacob",
            "Yes. Thirty seats, month to month, and if you go annual after, the pilot month counts toward it.",
          ],
          ["Dana", "That works."],
        ],
      },
      {
        topic: "next-steps",
        lines: [
          [
            "Jacob",
            "Okay, so, next steps. Let me, let me make sure I've got it.",
          ],
          [
            "Jacob",
            "I'll send over the annual pricing for a hundred and twenty by, let's say Wednesday. And a pilot agreement for thirty seats.",
          ],
          ["Dana", "Great."],
          [
            "Alice",
            "And Marcus, I'll send you the SSO setup doc and we can book the setup call once the pilot's signed.",
          ],
          [
            "Marcus",
            "Sounds good. I'll come back to you on the EU thing once I hear from legal.",
          ],
          [
            "Dana",
            "And I'll get the list of the thirty pilot people to you. Probably Monday, I need to run it by the dispatch managers.",
          ],
          ["Jacob", "Perfect. Thanks both, this was really helpful."],
          ["Dana", "Thank you. Talk soon."],
          ["Marcus", "Bye."],
        ],
      },
    ],
  },
  {
    name: "long-planning",
    expect:
      "Q4 roadmap worked item by item (frame, read-only seat, SCIM; mobile essentials, EU region and the final list optional), then the offsite",
    blocks: [
      {
        topic: "roadmap-frame",
        lines: [
          [
            "Jacob",
            "Okay. So this is the Q4 thing. I want to walk out of here with, like, the three things we're actually doing, not the fifteen things we'd like to do.",
          ],
          ["Alice", "Good luck."],
          ["Jacob", "Ha. Yeah."],
          [
            "Jacob",
            "So the list as it stands. Voice memory, which is in flight. Mobile parity, which is, it's a lot. The read-only seat that Halvorsen asked for. SCIM. The EU region. And then the whole, um, the playbooks thing.",
          ],
          ["Bob", "And the Android background audio bug."],
          [
            "Jacob",
            "And that, yeah. Which is a bug, not a roadmap item, but sure.",
          ],
          [
            "Alice",
            "Can I just say what I think the frame should be? Because I think if we argue item by item we'll be here all day.",
          ],
          ["Jacob", "Go."],
          [
            "Alice",
            "Q4 is about closing the pilots we have. Halvorsen, the two agencies, and whoever comes out of the launch. So anything that a pilot has literally asked for goes above anything that we think is cool.",
          ],
          ["Bob", "Mm-hmm."],
          [
            "Alice",
            "And by that frame, playbooks is out. Nobody asked for it. We want it, I want it, but nobody's asked.",
          ],
          [
            "Jacob",
            "I mean, I agree with the frame. I don't love losing playbooks for a whole quarter but, yeah, I agree.",
          ],
        ],
      },
      {
        topic: "mobile-essentials",
        optional: true,
        lines: [
          [
            "Bob",
            "Sorry, can I, on mobile. Is mobile parity a pilot ask? Because Halvorsen's dispatchers are basically all on phones.",
          ],
          [
            "Alice",
            "Parts of it are. They need to be able to read, ask Lor, and get into a call. They don't need, like, approvals on the phone, or the settings screens.",
          ],
          [
            "Bob",
            "Okay, so it's a subset. That's fine, that's actually helpful.",
          ],
          [
            "Jacob",
            "Let's call that mobile essentials and write down what's in it. Bob can you own that list?",
          ],
          ["Bob", "Yep."],
        ],
      },
      {
        topic: "read-only-seat",
        lines: [
          [
            "Jacob",
            "Okay, read-only seat. Dana asked, the agencies kind of asked. It's a pricing thing as much as a product thing.",
          ],
          [
            "Alice",
            "So the product side is actually small. It's a role that can't post. We basically have that already with custom roles. The hard part is billing. Autumn has to know about two seat types.",
          ],
          ["Jacob", "How hard."],
          [
            "Alice",
            "I'd say a week? Maybe a week and a half with the migration for existing workspaces. The question is really what we charge for it.",
          ],
          ["Bob", "Five bucks? Something like that?"],
          [
            "Jacob",
            "I was thinking free up to some number and then five. Like, if it's free, Dana's hundred and twenty people becomes thirty paid plus ninety free, and that's a much easier sale.",
          ],
          [
            "Alice",
            "Free read-only seats also means the Lor usage is pooled across fewer paid seats though. Ninety people reading answers that thirty people paid for.",
          ],
          ["Jacob", "Can read-only seats ask Lor?"],
          [
            "Alice",
            "That's, yeah, that's the actual question. If they can't, it's a much weaker seat. If they can, we have to price it.",
          ],
          [
            "Bob",
            "What if they can ask but it comes out of the pool, and the pool is what you buy. Like seats are seats and credits are credits.",
          ],
          [
            "Jacob",
            "That's kind of where billing was going anyway. Okay, let's not solve pricing on this call. The item is: read-only seat, Alice owns, pricing decided separately by the end of the month.",
          ],
          ["Alice", "Okay."],
        ],
      },
      {
        topic: "scim",
        lines: [
          [
            "Jacob",
            "SCIM. Marcus asked but he also said they could live without it for a while.",
          ],
          [
            "Bob",
            "SCIM is one of those things where it's two weeks of work and then a month of edge cases. Every directory does it slightly differently.",
          ],
          [
            "Alice",
            "I'd push it to Q1. Nobody's blocked. It's a nice to have for one customer who said it's a nice to have.",
          ],
          ["Jacob", "Agreed. Q1."],
        ],
      },
      {
        topic: "eu-region",
        optional: true,
        lines: [
          [
            "Jacob",
            "EU region. Same? Marcus is checking with legal, we don't know if it's real.",
          ],
          [
            "Alice",
            "Same. If legal comes back and says it's a blocker then we talk about it. Otherwise it's not on the list.",
          ],
          ["Bob", "Yeah."],
        ],
      },
      {
        topic: "final-list",
        optional: true,
        lines: [
          [
            "Jacob",
            "Okay so that leaves voice memory, mobile essentials, read-only seat. Plus bugs. Is that three things? That feels like three things.",
          ],
          [
            "Alice",
            "It's three things. Voice memory is mostly done though, right? That's like two more weeks?",
          ],
          [
            "Jacob",
            "Two, three weeks. Search, the summary screen, delete. Then it's done done.",
          ],
          [
            "Bob",
            "And the Android background audio thing has to happen before Halvorsen's dispatchers use calls at all. Half of them are on Android.",
          ],
          [
            "Jacob",
            "Right. That's a bug that's blocking a pilot so it's just, it's first.",
          ],
          [
            "Alice",
            "Can we also put a line in for the stuff we're explicitly not doing? Like a not-doing list. So when somebody asks about playbooks in November we can point at it.",
          ],
          [
            "Jacob",
            "Yes. Playbooks, SCIM, EU region. Not doing in Q4, revisit in January.",
          ],
          [
            "Jacob",
            "Okay. I'm going to write this up. Three items, owners, the not-doing list. Everyone okay?",
          ],
          ["Alice", "Yep."],
          ["Bob", "Yeah, good."],
        ],
      },
      {
        topic: "offsite",
        lines: [
          [
            "Jacob",
            "Okay. Um. Last thing and then we're done. The offsite. We said November, we haven't picked a week.",
          ],
          [
            "Alice",
            "Not the week of the launch, please. Not the week after either, honestly.",
          ],
          [
            "Jacob",
            "So that's the twentieth and the twenty-seventh out. First week of December?",
          ],
          [
            "Bob",
            "I'm out the first week of December, that's my brother's wedding.",
          ],
          ["Jacob", "Right, you said. Okay, second week of December."],
          ["Alice", "That works for me."],
          ["Bob", "Me too."],
          [
            "Jacob",
            "Where. Last time we did the cabin thing and it was great until the wifi died.",
          ],
          [
            "Alice",
            "I'd honestly do a city this time. Somewhere we can actually work during the day and then go out. The cabin was fun but we got nothing done.",
          ],
          ["Bob", "Lisbon?"],
          ["Alice", "Lisbon's good. Or Mexico City."],
          [
            "Jacob",
            "I'll look at flights for both and send a poll. Three days, two nights, second week of December.",
          ],
          ["Bob", "Sounds good."],
          ["Jacob", "Okay. That's everything. Thanks guys."],
        ],
      },
    ],
  },
]
