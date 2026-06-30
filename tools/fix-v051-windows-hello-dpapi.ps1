param(
  [string]$Project = "C:\Projetos\KPassword"
)

$ErrorActionPreference = "Stop"

$LibPath = Join-Path $Project "src-tauri\src\lib.rs"

if (-not (Test-Path $LibPath)) {
  throw "src-tauri\src\lib.rs não encontrado em $Project"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupPath = "$LibPath.backup-windows-hello-dpapi-$timestamp"
Copy-Item $LibPath $BackupPath -Force

$lib = Get-Content $LibPath -Raw -Encoding UTF8

$oldImportPattern = '    use windows_sys::Win32::Security::Cryptography::\{\s*CryptProtectData,\s*CryptUnprotectData,\s*DATA_BLOB,\s*CRYPTPROTECT_UI_FORBIDDEN,\s*\};\s*    use windows_sys::Win32::System::Memory::LocalFree;'

$newFfi = @'
    use std::ffi::c_void;

    #[repr(C)]
    struct DATA_BLOB {
        cbData: u32,
        pbData: *mut u8,
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[link(name = "Crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const DATA_BLOB,
            sz_data_descr: *const u16,
            p_optional_entropy: *const DATA_BLOB,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut DATA_BLOB,
        ) -> i32;

        fn CryptUnprotectData(
            p_data_in: *const DATA_BLOB,
            ppsz_data_descr: *mut *mut u16,
            p_optional_entropy: *const DATA_BLOB,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut DATA_BLOB,
        ) -> i32;
    }

    #[link(name = "Kernel32")]
    extern "system" {
        fn LocalFree(h_mem: *mut c_void) -> *mut c_void;
    }
'@

if ([regex]::IsMatch($lib, $oldImportPattern)) {
  $lib = [regex]::Replace($lib, $oldImportPattern, $newFfi)
  Set-Content -Path $LibPath -Value $lib -Encoding UTF8

  Write-Host ""
  Write-Host "DPAPI do Windows Hello corrigido." -ForegroundColor Green
  Write-Host "Backup criado em: $BackupPath" -ForegroundColor Yellow
  Write-Host ""
  exit 0
}

if ($lib -match 'struct DATA_BLOB' -and $lib -match 'fn CryptProtectData') {
  Write-Host ""
  Write-Host "O patch de DPAPI já parece estar aplicado. Nada foi alterado." -ForegroundColor Yellow
  Write-Host "Backup criado em: $BackupPath" -ForegroundColor Yellow
  Write-Host ""
  exit 0
}

throw "Não encontrei o bloco esperado de imports windows_sys no lib.rs. Envie o src-tauri\src\lib.rs atual para eu ajustar manualmente."
