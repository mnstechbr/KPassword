# Tools do KPassword

## Scripts mantidos

```text
fix-updater-v030-build.ps1
fix-updater-v030-build.cjs
```

São os scripts principais para gerar instalador, assinatura e `latest.json`.

## Scripts adicionados na v0.7.2

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
powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "0.7.2"
```
