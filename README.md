# KPassword

KPassword é um gerenciador de senhas local/offline para Windows, feito com Tauri, React e Rust.

O foco do projeto é manter o cofre no computador do usuário, sem conta obrigatória, sem nuvem obrigatória e sem envio de senhas, TOTP secrets ou backups para serviços externos pelo app.

## Recursos principais

- Cofre local criptografado com senha mestra.
- Backups criptografados `.kpvault`.
- Verificação de backup sem restaurar o cofre atual.
- Credenciais, notas seguras, cartões, identidades e licenças.
- TOTP/2FA opcional dentro da credencial.
- Leitura local de QR Code por imagem, print ou seleção de tela.
- Assistente do Cofre com próximas ações sugeridas.
- Diagnóstico de senhas fracas, reutilizadas, antigas, vencidas ou sem 2FA.
- Tags, busca e filtros rápidos.
- Importação CSV com prévia.
- Exportação CSV para migração, com aviso de risco.
- Windows Hello/PIN/biometria como desbloqueio rápido opcional no dispositivo.
- Atualização via GitHub Releases com assets assinados.
- Interface com ações principais em destaque e opções avançadas agrupadas atrás de um único controle quando não são necessárias.

## Segurança e privacidade

O KPassword protege o cofre em repouso no computador local. A senha mestra é necessária para abrir o cofre e não pode ser recuperada pelo projeto.

O desbloqueio com Windows Hello é uma conveniência local protegida pelo contexto Windows/DPAPI do usuário. Ele não substitui a senha mestra e não deve ser entendido como segundo fator separado.

Guardar senha e 2FA no mesmo cofre aumenta a praticidade, mas reduz a separação entre fatores. Quem quiser maior separação pode manter o TOTP em um autenticador separado.

Arquivos CSV exportados não são criptografados. Use CSV apenas para migração temporária e apague o arquivo com segurança depois do uso. Para backup, use `.kpvault`.

## Build local

```powershell
cd C:\Projetos\KPassword
npm install
npm run build
```

Build oficial de release:

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "1.2.0"
npm run release:hash -- -ReleaseDir ".\dist-release\v1.2.0"
npm run release:validate -- -ReleaseDir ".\dist-release\v1.2.0"
```

## Assets de release

Publique apenas estes arquivos no GitHub Release:

- `KPassword-Setup-v<versao>.exe`
- `KPassword-Setup-v<versao>.exe.sig`
- `latest.json`
- `SHA256SUMS.txt`

Não envie arquivos auxiliares locais, zips de patch ou pastas de build.
