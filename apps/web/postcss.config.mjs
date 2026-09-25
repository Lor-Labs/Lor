import tailwindcss from "@tailwindcss/postcss"

// @tailwindcss/typography excludes `[class~="not-prose"]` subtrees in every prose
// rule. WebKit (desktop app, Safari) tokenizes that attribute per ancestor on each
// style pass, ~250ms per full recalc on long channels. `.not-prose` matches the
// same elements through WebKit's fast class path. Kept out of the shared config
// because Next.js (www) only accepts string-named PostCSS plugins.
const notProseClassSelector = {
  postcssPlugin: "not-prose-class-selector",
  OnceExit(root) {
    root.walkRules((rule) => {
      if (rule.selector.includes("not-prose"))
        rule.selector = rule.selector.replace(
          /\[class~=(["']?)not-prose\1\]/g,
          ".not-prose"
        )
    })
  },
}

export default { plugins: [tailwindcss(), notProseClassSelector] }
