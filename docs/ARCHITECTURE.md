# Arquitetura do KPassword

## Visão geral

```text
React/TypeScript
  Interface, estado do cofre, formulários, temas, idiomas

WebCrypto
  Derivação de chave, criptografia e descriptografia do cofre

Tauri/Rust
  Arquivos locais, bandeja, janela, notificações, backups, integração Windows

GitHub Releases
  Distribuição e atualização automática
```

## Arquivos principais

```text
src/App.tsx
  Interface principal e fluxos do app

src/App.css
  Estilos, temas e responsividade

src/i18n.ts
  Traduções PT / EN / ES / TR

src/types.ts
  Tipos do cofre e itens

src/crypto.ts
  Criptografia WebCrypto

src/password.ts
  Geração e avaliação de senhas

src/vault-storage.ts
  Ponte com comandos Tauri

src/tray-guard.ts
  Bloqueio, bandeja e comportamento da janela

src-tauri/src/lib.rs
  Backend Tauri/Rust

src-tauri/tauri.conf.json
  Configuração do app, bundle e updater

tools/fix-updater-v030-build.ps1
tools/fix-updater-v030-build.cjs
  Geração de instalador assinado e latest.json
```

## Cofre

O cofre é persistido como arquivo `.kpvault`.

Cada cofre pode ter senha mestra própria e backup separado.

## Multi-cofres

A seleção do cofre ativo é uma preferência local fora do cofre criptografado.

Os dados internos de cada cofre continuam criptografados separadamente.

## Design

O design deve manter:

- Layout fluido.
- Sem dependência de largura fixa.
- Modo compacto funcional.
- Desktop como experiência principal.
- Estrutura preparada para futura evolução web/mobile.
