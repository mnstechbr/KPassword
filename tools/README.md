# Tools do KPassword

Scripts de apoio ao desenvolvimento e à release. Os scripts de patch avulsos
das versões antigas (`apply-v08x-*`, `fix-*`, `update-v071-*`, `tools/archive/`
etc.) foram removidos: continuam disponíveis no histórico do git.

## Release (Node, Windows e Fedora)

Somente stdlib do Node; não exigem PowerShell nem `npm install` extra.

| Script | npm | O que faz |
| --- | --- | --- |
| `version-check.mjs` | `npm run version:check` | Confere as sete fontes de versão (também roda na CI). |
| `generate-release-checksums.mjs` | `npm run release:hash` | Gera `SHA256SUMS.txt` para `latest.json`, `KPassword*.exe` e `.exe.sig`; recusa pasta com arquivo sensível. |
| `validate-release-assets.mjs` | `npm run release:validate` | Confere instalador, `.sig`, `latest.json`, `SHA256SUMS.txt` e ausência de arquivos sensíveis antes de anexar no GitHub. |
| `security-audit.mjs` | `npm run security:audit` | `npm run build`, `cargo check`, `cargo test`, `npm audit`, dependências com quick-xml e `cargo audit` (se instalado). |
| `release-cli.mjs` | — | Helpers compartilhados pelos dois scripts de assets. |

Os parâmetros aceitam o estilo antigo do PowerShell e o estilo Unix:

```sh
npm run release:hash -- -ReleaseDir ./dist-release/v<versao>
npm run release:validate -- --release-dir ./dist-release/v<versao> --expected-version <versao>
```

Caminhos no estilo Windows (`".\dist-release\v<versao>"`) dos checklists
também funcionam no Fedora.

## Build do instalador Windows e updater

```text
fix-updater-v030-build.ps1   build NSIS assinado + dist-release\v<versao> (pede a senha da chave)
fix-updater-v030-build.cjs   etapa Node chamada pelo .ps1 acima
release-artifacts.cjs        seleção fail-closed de instalador/.sig (testado por release-artifacts.test.mjs)
build-updater-release.ps1    wrapper legado que encaminha para fix-updater-v030-build.ps1
build-updater-release.cjs    montagem antiga de dist-release (sem chamadas atuais)
release-version.ps1          validação antes da release; chama audit-project.ps1
audit-project.ps1            versões sincronizadas, arquivos essenciais, chaves locais
```

Fluxo normal no Windows:

```powershell
npm run build
powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "<versao>"
npm run release:hash -- -ReleaseDir ".\dist-release\v<versao>"
npm run release:validate -- -ReleaseDir ".\dist-release\v<versao>"
```

## Assinatura e publicação via CI

```text
release-signer/          assinador Rust (cargo build --release --manifest-path tools/release-signer/Cargo.toml)
sign-release.py          gera chaves e assina artefatos localmente
publish-release.py       baixa artefatos da CI, assina e publica (docs/releases/SIGNING.md)
```

## Secrets Bridge (Fedora)

```text
kpassword_bridge_client.py           cliente Unix do Bridge (empacotado no RPM)
kpassword_claude_proxy.py            proxy para o Claude (empacotado no RPM)
kpassword_mcp.py                     servidor MCP genérico (empacotado no RPM)
kpassword_universal_integration.py   verificação manual com o Bridge ativo
```

Veja `docs/integrations/`.

## Testes

A CI roda os testes Python e o `npm test` (vitest pega os `tools/*.test.mjs`):

```sh
python3 tools/release-signer.test.py
python3 tools/publish-release.test.py
python3 tools/kpassword_bridge_client.test.py
python3 tools/kpassword_claude_proxy.test.py
python3 tools/kpassword_mcp.test.py
npm test
```

## Outros

```text
generate-vault-vectors.py   reproduz os vetores de teste do cofre (docs/FEDORA_NATIVE.md)
v095-samples/               CSV de exemplo para a prévia de importação
v100-samples/               exemplos de TOTP (otpauth e QR)
```
