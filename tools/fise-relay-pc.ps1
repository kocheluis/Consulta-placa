<#
  Relay RESIDENCIAL de FISE en la PC de casa (Windows) — PlacaPe.

  FISE (fise.minem.gob.pe:23308) solo responde a internet doméstico peruano: rechaza la IP del VPS. Esta
  PC es el relay PRINCIPAL (prioridad 1) y el celular el RESPALDO (prioridad 2): el VPS manda cada
  consulta al relay vivo de mejor prioridad y cae al otro si no responde.

  Qué hace:
    - Guarda la configuración (URL del VPS + token del relay) en %USERPROFILE%\.placape\fise-relay.json,
      legible solo por tu usuario. El token NO queda en la tarea ni en el repo.
    - Copia el worker (tools\fise-relay-celular.mjs, cero dependencias) a %USERPROFILE%\.placape\.
    - Crea la tarea programada "PlacaPe FISE relay": arranca al iniciar sesión, oculta, sin límite de
      tiempo, se reinicia sola si se cae, y un supervisor relanza el worker si termina.
    - Prueba que esta red alcanza FISE y que el VPS ve a la PC latiendo.

  Uso (PowerShell, en la carpeta del proyecto):
    Primera vez:   powershell -ExecutionPolicy Bypass -File tools\fise-relay-pc.ps1 -Vps http://IP-DEL-VPS:3011 -Token EL_TOKEN
    Reactivar:     powershell -ExecutionPolicy Bypass -File tools\fise-relay-pc.ps1
    Estado:        powershell -ExecutionPolicy Bypass -File tools\fise-relay-pc.ps1 -Estado
    Quitar:        powershell -ExecutionPolicy Bypass -File tools\fise-relay-pc.ps1 -Quitar
    Opcional:      -SinSuspension  (evita que la PC se suspenda enchufada: si duerme, el relay no late)
#>
param(
  [string]$Vps,
  [string]$Token,
  [switch]$Estado,
  [switch]$Quitar,
  [switch]$SinSuspension
)
$ErrorActionPreference = 'Stop'
$TaskName = 'PlacaPe FISE relay'
$Dir = Join-Path $env:USERPROFILE '.placape'
$Conf = Join-Path $Dir 'fise-relay.json'
$Worker = Join-Path $Dir 'fise-relay.mjs'
$Runner = Join-Path $Dir 'fise-relay-run.ps1'
$Log = Join-Path $Dir 'fise-relay.log'

function Read-Conf { if (Test-Path $Conf) { Get-Content $Conf -Raw | ConvertFrom-Json } else { $null } }

function Show-Estado {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($t) { Write-Host "Tarea: $($t.State)" } else { Write-Host 'Tarea: NO instalada' }
  $c = Read-Conf
  if ($c) {
    try {
      $s = Invoke-RestMethod -Uri ("$($c.vps)/api/fise-relay/status") -TimeoutSec 10
      $pc = $s.relays | Where-Object { $_.id -eq 'pc' }
      if ($pc -and $pc.alive) { Write-Host "VPS: la PC está LATIENDO (atendidas ok: $($pc.done), fallas: $($pc.fails))" -ForegroundColor Green }
      else { Write-Host 'VPS: todavía no ve a la PC latiendo' -ForegroundColor Yellow }
      $cel = $s.relays | Where-Object { $_.id -eq 'celular' }
      if ($cel) { Write-Host ("Celular (respaldo): " + $(if ($cel.alive) { 'latiendo' } else { 'sin señal' })) }
    } catch { Write-Host "VPS: no responde ($($_.Exception.Message))" -ForegroundColor Yellow }
  }
  if (Test-Path $Log) { Write-Host "`nÚltimas líneas del log ($Log):"; Get-Content $Log -Tail 8 }
}

if ($Estado) { Show-Estado; exit 0 }

if ($Quitar) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*fise-relay.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Write-Host 'Relay de la PC quitado (la configuración queda en' $Dir ')'
  exit 0
}

# ── Requisitos ───────────────────────────────────────────────────────────
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'No encuentro Node.js. Instálalo (https://nodejs.org, versión LTS) y vuelve a correr este script.' }
$src = Join-Path $PSScriptRoot 'fise-relay-celular.mjs'
if (-not (Test-Path $src)) { throw "No encuentro $src (corre el script desde la carpeta del proyecto)." }

# ── Configuración (el token solo se pide la primera vez) ─────────────────
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
# SID del usuario actual (el nombre en %USERNAME% no siempre coincide con la cuenta: cuentas Microsoft).
$Sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if (Test-Path $Conf) { icacls $Conf /grant:r "*${Sid}:(F)" | Out-Null } # repara permisos de una versión anterior
$c = Read-Conf
if (-not $Vps) { $Vps = $c.vps }
if (-not $Token) { $Token = $c.token }
if (-not $Vps -or -not $Token) { throw 'Primera vez: indica -Vps http://IP-DEL-VPS:3011 y -Token EL_TOKEN (el token del relay; en el VPS: placape-ops fise-token).' }
$Vps = $Vps.TrimEnd('/')
@{ vps = $Vps; token = $Token } | ConvertTo-Json | Set-Content -Path $Conf -Encoding UTF8
# Solo tu usuario puede leer la configuración (lleva el token).
icacls $Conf /inheritance:r /grant:r "*${Sid}:(F)" | Out-Null

Copy-Item $src $Worker -Force

# ── Supervisor: relanza el worker si termina; log rotado a ~1 MB ─────────
@"
`$ErrorActionPreference = 'Continue'
`$c = Get-Content '$Conf' -Raw | ConvertFrom-Json
while (`$true) {
  if ((Test-Path '$Log') -and (Get-Item '$Log').Length -gt 1MB) { Move-Item '$Log' '$Log.1' -Force }
  & '$node' '$Worker' `$c.vps `$c.token pc 1 *>> '$Log'
  Add-Content '$Log' ("[" + (Get-Date -Format 'HH:mm:ss') + "] worker terminó (código `$LASTEXITCODE) → reinicio en 10 s")
  Start-Sleep -Seconds 10
}
"@ | Set-Content -Path $Runner -Encoding UTF8

# ── ¿Esta red alcanza FISE? ───────────────────────────────────────────────
Write-Host 'Probando que esta red alcanza FISE…'
& $node $Worker test

# ── Tarea programada ──────────────────────────────────────────────────────
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*fise-relay.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Runner`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Relay residencial de FISE para PlacaPe (principal). Ver tools/fise-relay-pc.ps1' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

if ($SinSuspension) {
  powercfg /change standby-timeout-ac 0
  Write-Host 'Suspensión desactivada mientras la PC esté enchufada.'
}

Write-Host 'Esperando el primer latido…'
Start-Sleep -Seconds 12
Show-Estado
Write-Host "`nListo. El relay arranca solo cada vez que inicias sesión en Windows."
