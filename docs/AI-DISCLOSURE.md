# AI-assisted work disclosure

This disclosure covers tools that assisted in producing this submission. It is based on evidence in
the repository and in documentation preserved in Git history (notably
`git show HEAD:docs/DECLARATION-IA.md` and `git show HEAD:docs/WRITEUP.md`). No other tool is
claimed.

| Tool | What it was used for |
|---|---|
| ZeroClaw coding agents | Writing TypeScript/React code, tests, CI configuration and documentation |
| Claude / Claude Code | Visual design system, English site copy and design boards |
| opencode | Edge proxy implementation, home screen, deployment work, documentation and compliance review |
| Models served through InferHub | Automatic resolution of rebase conflicts and PR scope drafting in the merge queue |
| InferHub vision/text models | Product feature: reading corrected papers and generating targeted exercises |

Product decisions — the closed error taxonomy, weighting rules, relevance guard and prompts — were
specified by the author. The larger share of the code volume was produced with the coding assistants
listed above.

The pre-existing codebase and its earlier AI use are described in [`PROVENANCE.md`](../PROVENANCE.md).
Third-party libraries, datasets, assets and their licences are listed in [`CREDITS.md`](../CREDITS.md).
