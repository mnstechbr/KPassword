# Arquitetura do KPassword

## Visão geral

```text
React/TypeScript
  Interface, estado de tela, filtros, temas, idiomas e chamadas aos comandos Tauri.

Tauri/Rust
  Núcleo local do app: arquivos, criptografia do cofre, backups, verificação de backup,
  bandeja, janela, notificações, Windows Hello e integração com o Windows.

GitHub Releases
  Distribuição do instalador, artefatos do updater assinado e arquivos de verificação.
```

O KPassword é um gerenciador de senhas local/offline para Windows. O cofre fica no computador do usuário e não depende de conta, servidor próprio ou nuvem obrigatória.

## Fronteira entre frontend e backend

O frontend React organiza a experiência do usuário e mantém apenas o estado necessário para a sessão desbloqueada. Ele chama comandos Tauri para carregar, salvar, verificar e proteger dados locais.

O núcleo criptográfico principal está no backend Rust, em `src-tauri/src/crypto_vault.rs`, exposto por comandos em `src-tauri/src/lib.rs`. Documentação antiga que apontava APIs do navegador como núcleo principal não representa mais a arquitetura atual.

`src/crypto.ts` permanece no frontend como parte da base histórica/compatibilidade da aplicação, mas não deve ser tratado como a fonte principal da criptografia atual do cofre.

## Arquivos principais

```text
src/App.tsx
  Interface principal e fluxos do app.

src/App.css
  Estilos, temas, responsividade e modo compacto.

src/i18n.ts
  Traduções PT / EN / ES / TR.

src/types.ts
  Tipos do cofre, itens, diagnóstico e estruturas do app.

src/vault-storage.ts
  Ponte TypeScript com comandos Tauri.

src/password.ts
  Geração e avaliação local de senhas.

src/tray-guard.ts
  Bloqueio, bandeja e comportamento da janela.

src-tauri/src/crypto_vault.rs
  Criptografia, descriptografia e verificação do payload criptografado.

src-tauri/src/lib.rs
  Comandos Tauri, armazenamento local, backups, Windows Hello e integração nativa.

src-tauri/tauri.conf.json
  Configuração do app, bundle, CSP e updater assinado.
```

## Cofre e criptografia

O cofre é persistido como arquivo `.kpvault`.

Cofres novos usam `cryptoVersion 2` com:

- Argon2id para derivação de chave;
- AES-256-GCM para criptografia autenticada;
- AAD para autenticar metadados críticos;
- nonce novo por salvamento.

Cofres legados podem ser lidos para compatibilidade. Ao abrir um cofre legado com sucesso, o app cria backup pré-migração identificado como `pre-argon2` e regrava o cofre principal no formato atual.

## Backups

Backups são arquivos `.kpvault` criptografados. Cada cofre pode ter senha mestra própria e área de backups separada.

O app também possui verificação de backup sem restauração: o arquivo é lido e validado com a senha informada, mas o cofre atual não é substituído durante essa verificação.

## Recursos locais

- Autolock e envio para bandeja.
- Clipboard revisado com limpeza após tempo configurado.
- Windows Hello opcional como conveniência local, sem substituir a senha mestra.
- TOTP/autenticador 2FA armazenado no cofre quando o usuário decide guardar esse segredo junto da credencial.
- Multi-cofres locais.
- Diagnóstico do cofre com explicações e filtros para itens que merecem revisão.

## Release e atualização

O fluxo de release gera uma pasta em `dist-release\v<versao>` com os assets públicos:

```text
KPassword-Setup-v<versao>.exe
KPassword-Setup-v<versao>.exe.sig
latest.json
SHA256SUMS.txt
```

O updater usa `latest.json` e a assinatura `.sig`. A pasta de release deve ser validada antes da publicação:

```powershell
npm run release:hash -- -ReleaseDir ".\dist-release\v<versao>"
npm run release:validate -- -ReleaseDir ".\dist-release\v<versao>"
```

O validador confere instalador, assinatura, `latest.json`, hashes quando presentes e ausência de arquivos sensíveis.

## Design

O design deve manter:

- Layout fluido.
- Sem dependência de largura fixa.
- Modo compacto funcional.
- Desktop como experiência principal.
- Estrutura preparada para futura evolução web/mobile.
