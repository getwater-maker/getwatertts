$WshShell = New-Object -ComObject WScript.Shell
$Desktop = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $Desktop "Supertonic.lnk"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "D:\supertonic\dist\Supertonic\Supertonic.exe"
$Shortcut.WorkingDirectory = "D:\supertonic\dist\Supertonic"
$Shortcut.Description = "Supertonic TTS Desktop App"
$Shortcut.Save()

Write-Host "바로가기가 바탕화면에 생성되었습니다: $ShortcutPath"
