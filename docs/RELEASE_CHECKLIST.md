# Checklist de Release

## Validação local

```powershell
cd C:\Projetos\KPassword
npm run build
cd src-tauri
cargo check
cargo test
cargo clippy
cd ..
git status --short
```

Confirmar:

- [ ] `npm run build` passou.
- [ ] `cargo check`, `cargo test` e `cargo clippy` passaram em `src-tauri`.
- [ ] Versão em `package.json` está correta.
- [ ] Versão em `package-lock.json` está correta.
- [ ] Versão em `src-tauri/tauri.conf.json` está correta.
- [ ] `APP_VERSION` em `src/App.tsx` está correta.
- [ ] QA básico executado.
- [ ] Teste manual do app executado.
- [ ] Teste de importação CSV com prévia executado.
- [ ] Teste de exportação CSV com aviso de não criptografado executado.
- [ ] Teste de tags e filtros rápidos executado.
- [ ] Teste de TOTP por print/imagem com QR Code executado.
- [ ] Teste de seleção de QR Code na tela executado.
- [ ] Teste do Assistente do Cofre, botões e temas executado.
- [ ] Nenhuma chave privada foi adicionada ao projeto.

## Commit

```powershell
git add -- .gitignore .github docs tools package.json package-lock.json README.md SECURITY.md TERMS.md CRYPTOGRAPHY.md RELEASE_CHECKLIST.md VULNERABILITY_POLICY.md index.html tsconfig.json vite.config.ts src src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src-tauri/build.rs src-tauri/capabilities src-tauri/src
git commit -m "Mensagem da versão"
git push
```

Não use `git add .` no fluxo de release. O staging deve ser explícito para reduzir risco de incluir cofres, backups, chaves ou arquivos locais por engano. Scripts de release não devem fazer commit ou push automaticamente.

## Gerar instalador/updater

A chave privada do updater deve existir fora do repositório, protegida por senha forte. O script de build vai pedir a senha da chave e não fará commit ou push.

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "<versao>"
npm run release:hash -- -ReleaseDir ".\dist-release\v<versao>"
npm run release:validate -- -ReleaseDir ".\dist-release\v<versao>"
```

Confirmar:

- [ ] `SHA256SUMS.txt` foi gerado.
- [ ] Validação de assets passou antes de publicar.

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
C:\Projetos\KPassword\dist-release\v<versao>\SHA256SUMS.txt
```

Gerar hashes e validar antes de anexar:

```powershell
npm run release:hash -- -ReleaseDir ".\dist-release\v<versao>"
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
- [ ] Validar site oficial após a release.
- [ ] Validar página "Verificar download" com a nova release.

## Validações específicas v1.1.1

- [ ] CSV com notas multilinha importado corretamente.
- [ ] CSV com TOTP `otpauth://` importado corretamente.
- [ ] Imagem de QR grande recusada antes do processamento.
- [ ] Recorte do Windows para QR funcionando sem seletor estilo compartilhamento de tela.
- [ ] Leitor QR validado offline.
- [ ] Windows Hello descrito como conveniência local/DPAPI.

## Validações específicas v1.3.2

- [ ] Confirmar que a chave do updater tem senha forte.
- [ ] Confirmar que nenhum script fez commit/push automático.
- [ ] Confirmar recorte do Windows para QR, com minimização e retorno automático do app.
- [ ] Confirmar rejeição de imagens QR grandes no frontend e no Rust.
- [ ] Confirmar aviso reforçado da exportação CSV.
- [ ] Confirmar `cargo tree`/`cargo audit` para advisories transitivos como quick-xml.

## Validações específicas v1.3.3

- [ ] QR novo em credencial sem 2FA salva automaticamente e mantém a tela do código aberta.
- [ ] QR novo em credencial com 2FA existente mostra aviso e exige Substituir 2FA antes de trocar.
- [ ] Recorte do Windows continua minimizando, voltando ao app e lendo o QR.
- [ ] Toggle Iniciar com Windows cria/remove entrada KPassword nos Aplicativos de inicialização.
- [ ] Ao iniciar com `--startup`, o app abre direto na bandeja.
- [ ] Título do WebView aparece como KPassword, sem "Tauri + React + Typescript".
- [ ] App enviado à bandeja bloqueia o cofre e não mantém dados sensíveis em estado desbloqueado.
