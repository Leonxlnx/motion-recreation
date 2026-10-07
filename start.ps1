$filmProject = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $filmProject
Write-Host 'Open http://127.0.0.1:4173 in your browser. Press Ctrl+C to stop.'
node server.mjs
