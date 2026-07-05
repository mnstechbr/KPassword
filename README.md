# KPassword

KPassword é um gerenciador de senhas local/offline para Windows, criado com Tauri, React, TypeScript e Rust.

O objetivo do projeto é manter dados sensíveis em um cofre criptografado no próprio computador, sem depender de nuvem, servidor externo ou conta online.

## Recursos principais

- Cofre local/offline criptografado.
- Senha mestra.
- Desbloqueio opcional com PIN/biometria do computador.
- Multi-cofres locais.
- Credenciais, notas seguras, cartões, identidades e licenças/chaves.
- Histórico de senhas.
- Lixeira com restauração.
- Validade de senha e alertas.
- Gerador de senhas.
- TOTP/autenticador 2FA.
- Anexos criptografados.
- Importação CSV.
- Exportação JSON criptografada.
- Exportação CSV aberta com confirmação da senha mestra.
- Backups criptografados.
- Analítico com Diagnóstico do Cofre.
- Temas Escuro, Claro e Misto.
- Idiomas: Português, Inglês, Espanhol e Turco.
- Bandeja do sistema com modo completo, modo compacto e sair.
- Atualização automática via GitHub Releases.

## Princípios do projeto

- Local primeiro.
- Offline por padrão.
- Sem recuperação da senha mestra.
- Sem envio de dados para nuvem.
- Interface simples, objetiva e flexível.
- Design preparado para futura evolução web/mobile, sem depender de medidas fixas.

## Requisitos de desenvolvimento

- Windows.
- Node.js/npm.
- Rust/Cargo.
- Microsoft C++ Build Tools.
- WebView2 Runtime.
- Git.

## Rodar em desenvolvimento

```powershell
cd C:\Projetos\KPassword
npm install
npm run tauri dev
```

## Build do frontend

```powershell
cd C:\Projetos\KPassword
npm run build
```

## Gerar instalador/updater

Use o script principal mantido no projeto:

```powershell
cd C:\Projetos\KPassword
powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "<versao>"
```

Os arquivos de release serão gerados em:

```text
C:\Projetos\KPassword\dist-release\v<versao>
```

Anexe estes arquivos na release do GitHub:

```text
KPassword-Setup-v<versao>.exe
KPassword-Setup-v<versao>.exe.sig
latest.json
```

## Segurança

A senha mestra não possui recuperação. Isso é intencional. Se a senha mestra for perdida, o cofre e os backups criptografados não poderão ser descriptografados.

A chave privada de assinatura do updater não deve ser colocada no repositório.

## Documentação útil

- `docs/QA_CHECKLIST.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/USER_GUIDE.md`
- `docs/VAULT_DIAGNOSTIC.md`
- `docs/MAINTENANCE.md`
