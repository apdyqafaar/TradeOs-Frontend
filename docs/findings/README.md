# Findings

One file per implementation task. Agents write their own file here; the lead merges the durable
ones into `../FINDINGS.md` and deletes the rest.

Write a finding when you discover something the next person would otherwise rediscover the hard
way: an API that behaves differently from its documentation, a library quirk that cost you time, a
design-canvas detail that could not be implemented as drawn, a decision you had to make because the
plan was silent. Do not write one for work that simply went as planned.

Format — one `##` section per finding:

```markdown
## <short title>

**What:** the fact, stated plainly.
**Evidence:** the file, line, command output or test that proves it.
**So what:** what someone should do differently because of it.
```
