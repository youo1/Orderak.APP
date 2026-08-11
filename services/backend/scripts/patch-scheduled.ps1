$content = Get-Content -Path 'C:\Users\AymanAbdelLatif\Documents\Orderak\services\backend\src\index.ts' -Raw
$old = 'ctx.waitUntil(runRetentionCleanup(env));'
$new = 'ctx.waitUntil(runRetentionCleanup(env));' + "`r`n" + "`t`tctx.waitUntil(processDeletionRequests(env));"
$content = $content.Replace($old, $new)
Set-Content -Path 'C:\Users\AymanAbdelLatif\Documents\Orderak\services\backend\src\index.ts' -Value $content -NoNewline
Write-Output 'Done'