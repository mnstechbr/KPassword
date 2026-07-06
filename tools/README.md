# Tools do KPassword

## Scripts mantidos

```text
fix-updater-v030-build.ps1
fix-updater-v030-build.cjs
validate-release-assets.ps1
```

São os scripts principais para gerar instalador, assinatura e `latest.json`.
O `validate-release-assets.ps1` confere a pasta local de release antes dos arquivos serem anexados no GitHub.

## Scripts historicos e de manutenção

```text
audit-project.ps1
release-version.ps1
apply-v072-cleanup-docs.ps1
```

## Scripts antigos

Hotfixes antigos ficam em:

```text
tools/archive/
```

Eles são preservados para histórico, mas não fazem parte do fluxo normal de release.

## Fluxo normal

```powershell
cd C:\Projetos\KPassword
npm run build
powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "<versao>"
npm run release:validate -- -ReleaseDir ".\dist-release\v<versao>"
```
