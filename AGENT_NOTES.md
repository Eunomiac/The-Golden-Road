# Agent Notes: Workspace Paths

- The editing/analysis tools already operate relative to the synced workspace root. Prefer `read_file`, `apply_patch`, and related helpers instead of shell commands whenever possible.
- When a shell command is required, assume the working directory is a temporary environment that does **not** mirror the user's local drive letters (e.g., `D:\`). Use relative paths within the repository or change directories with `Set-Location`/`cd` only after verifying the path exists in the current shell session.
- Before referencing an absolute path, run `Get-Location` (PowerShell) or `pwd` (bash) to confirm the environment. If the desired path is missing, fall back to relative paths such as `.\data\planning\...` from the repo root.
- Avoid repeated failing `Set-Location` attempts. Instead, ensure commands begin with `Set-Location -LiteralPath "$PSScriptRoot/.."` or similar logic that relies on paths known to exist within the workspace snapshot.
- For file moves or copies, prefer the provided helper tools or PowerShell commands that operate on relative paths from the confirmed working directory.
- Document future environment-specific findings in this file so subsequent agents can avoid the same pitfalls.
