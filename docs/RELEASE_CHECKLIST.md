# Checklist de Release

## Antes do build

```powershell
cd C:\Projetos\KPassword
npm run build
git status --short
```

Confirmar:

- [ ] `npm run build` passou.
- [ ] `npm run release:validate -- -ReleaseDir ".\dist-release\v<versao>"` passou antes de publicar os assets.
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
powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "<versao>"
```

## Publicar release

Abrir:

```text
https://github.com/mnstechbr/KPassword/releases/new
```

Preencher:

```text
Tag: v<versao>
Title: KPassword v<versao>
```

Anexar:

```text
C:\Projetos\KPassword\dist-release\v<versao>\KPassword-Setup-v<versao>.exe
C:\Projetos\KPassword\dist-release\v<versao>\KPassword-Setup-v<versao>.exe.sig
C:\Projetos\KPassword\dist-release\v<versao>\latest.json
```

Validar antes de anexar:

```powershell
npm run release:validate -- -ReleaseDir ".\dist-release\v<versao>"
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
