# Checklist de Release

## Antes do build

```powershell
cd C:\Projetos\KPassword
npm run build
git status --short
```

Confirmar:

- [ ] `npm run build` passou.
- [ ] Versão em `package.json` está correta.
- [ ] Versão em `package-lock.json` está correta.
- [ ] Versão em `src-tauri/tauri.conf.json` está correta.
- [ ] `APP_VERSION` em `src/App.tsx` está correta.
- [ ] QA básico executado.
- [ ] Nenhuma chave privada foi adicionada ao projeto.

## Commit

```powershell
git add .
git commit -m "Mensagem da versão"
git push
```

## Gerar instalador/updater

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "0.7.2"
```

## Publicar release

Abrir:

```text
https://github.com/mnstechbr/KPassword/releases/new
```

Preencher:

```text
Tag: v0.7.2
Title: KPassword v0.7.2
```

Anexar:

```text
C:\Projetos\KPassword\dist-release\v0.7.2\KPassword-Setup-v0.7.2.exe
C:\Projetos\KPassword\dist-release\v0.7.2\KPassword-Setup-v0.7.2.exe.sig
C:\Projetos\KPassword\dist-release\v0.7.2\latest.json
```

## Depois de publicar

- [ ] Abrir app instalado.
- [ ] Verificar atualização.
- [ ] Atualizar.
- [ ] Confirmar reabertura.
- [ ] Confirmar versão.
- [ ] Abrir cofre antigo.
- [ ] Validar bandeja.
- [ ] Validar login.
