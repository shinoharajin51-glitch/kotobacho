$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot 'supabase-config.js'

Write-Host ''
Write-Host 'ことば帳のSupabase設定' -ForegroundColor Cyan
Write-Host 'Supabase Dashboard の Project Settings > API を開いてください。'
Write-Host ''

$projectUrl = (Read-Host 'Project URL（https://...supabase.co）').Trim()
$publishableKey = (Read-Host 'Publishable key（または旧 anon key）').Trim()

if ($projectUrl -notmatch '^https://[a-z0-9-]+\.supabase\.co/?$') {
  Write-Host 'Project URLの形式が正しくありません。' -ForegroundColor Red
  Read-Host 'Enter キーで閉じる'
  exit 1
}

if ($publishableKey -like 'sb_secret_*' -or $publishableKey -match 'service_role') {
  Write-Host '秘密鍵は設定できません。Publishable keyを使用してください。' -ForegroundColor Red
  Read-Host 'Enter キーで閉じる'
  exit 1
}

if ($publishableKey.Contains('.')) {
  try {
    $payloadPart = $publishableKey.Split('.')[1].Replace('-', '+').Replace('_', '/')
    while ($payloadPart.Length % 4 -ne 0) { $payloadPart += '=' }
    $payloadJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payloadPart))
    $payload = $payloadJson | ConvertFrom-Json
    if ($payload.role -eq 'service_role') {
      Write-Host 'service_roleキーは設定できません。anon keyを使用してください。' -ForegroundColor Red
      Read-Host 'Enter キーで閉じる'
      exit 1
    }
  } catch {
    # Publishable keyはJWT形式ではないため、解析できない場合はそのまま次の検査へ進みます。
  }
}

if ($publishableKey.Length -lt 20) {
  Write-Host 'キーが短すぎます。コピー内容を確認してください。' -ForegroundColor Red
  Read-Host 'Enter キーで閉じる'
  exit 1
}

$safeUrl = $projectUrl.TrimEnd('/') | ConvertTo-Json -Compress
$safeKey = $publishableKey | ConvertTo-Json -Compress
$content = @"
// このファイルは「Supabaseを設定する.bat」で作成されました。
// service_role key / secret key はブラウザ用ファイルに置かないでください。
window.SUPABASE_CONFIG = Object.freeze({
  url: $safeUrl,
  publishableKey: $safeKey,
});
"@

[System.IO.File]::WriteAllText($configPath, $content, [System.Text.UTF8Encoding]::new($false))
Write-Host ''
Write-Host '設定を保存しました。次に「起動する.bat」をダブルクリックしてください。' -ForegroundColor Green
Read-Host 'Enter キーで閉じる'
