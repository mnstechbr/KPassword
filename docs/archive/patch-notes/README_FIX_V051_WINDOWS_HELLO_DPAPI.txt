KPassword v0.5.1 - fix Windows Hello DPAPI

Corrige o erro de compilação:

unresolved import windows_sys::Win32::Security::Cryptography::DATA_BLOB
unresolved import windows_sys::Win32::System::Memory::LocalFree

O patch troca esses imports por chamadas FFI diretas do Windows:
- CryptProtectData
- CryptUnprotectData
- LocalFree

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-fix-v051-windows-hello-dpapi*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

powershell -ExecutionPolicy Bypass -File ".\tools\fix-v051-windows-hello-dpapi.ps1"

npm run build
npm run tauri dev
