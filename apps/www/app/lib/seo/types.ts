// Comparison and guide pages are plain data rendered by `SeoArticle`.
// Inline links use `[label](href)` and are parsed by `RichText`.
export type Block =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; columns: string[]; rows: string[][] }

export type Section = {
  id: string
  heading: string
  blocks: Block[]
}

export type Faq = {
  question: string
  answer: string
}

export type Source = {
  label: string
  url: string
}

export type SeoPage = {
  slug: string
  /** Visible H1. */
  title: string
  /** `<title>` and social title; keep under ~60 characters. */
  metaTitle: string
  /** Meta description; keep under ~160 characters. */
  description: string
  /** Short label for index cards and footer links. */
  label: string
  published: string
  /** Date competitor facts were last checked against vendor pages. */
  checkedOn: string
  intro: string[]
  summary: string[]
  sections: Section[]
  faqs: Faq[]
  sources: Source[]
  related: string[]
}
