Hand a task to Devin and get its answer back in this session.

## Getting started

1. After installing, open **Settings → Devin subagent** and check it reads Connected.
2. If it does not, sign in to Devin once on this machine using the command on the page (it copies with one click), or paste a key that starts with `devin-`.
3. Back in the conversation, let `subagent_devin` do the work.

The key lives in the system credential store only; the page never shows it and configuration never holds it. A key starting with `apk_user_` is a platform API key and cannot sign a subagent in.

Model and permissions are on the same page. Full documentation — every setting, troubleshooting, implementation notes — ships in `docs/`.
