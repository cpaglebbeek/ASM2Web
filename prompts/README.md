# prompts/

Sessie-MDs van Claude/Gemini/Codex op deze repo. Eén MD per logisch sessie-segment, conform Meta_Master Prompt Sessie Documentatie Protocol.

**Naam-conventie:** `YYYY-MM-DD_korte_slug.md` of bij newp `NNN_naam.md`.

**Verplichte frontmatter:**

```yaml
---
date: YYYY-MM-DD
repo: ASM2Web
status: open | pending | done
resume: "<korte trigger-zin of leeg bij done>"
---
```

`status: open|pending` + niet-lege `resume:` → sessie verschijnt in `Meta_Master/RESUME.md` na `tools/update_resume.py`.
