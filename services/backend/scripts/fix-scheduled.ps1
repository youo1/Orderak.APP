$path = Join-Path $PSScriptRoot "..\src\index.ts"
$content = Get-Content $path -Raw
$old = 'ctx.waitUntil(runRetentionCleanup(env));' + "`r`n" + "`t},"
$new = 'ctx.waitUntil(runRetentionCleanup(env));' + "`r`n" + "`t`tctx.waitUntil(processDeletionRequests(env));" + "`r`n" + "`t},"
$content = $content.Replace($old, $new)
Set-Content $path -Value $content -NoNewline
Write-Output "Patched scheduled handler in index.ts"