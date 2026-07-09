# KPassword

KPassword é um gerenciador de senhas local/offline para Windows, feito com Tauri, React, TypeScript e Rust.

O foco do projeto é manter o cofre no computador do usuário, sem conta obrigatória, sem nuvem obrigatória e sem envio de senhas, TOTP secrets ou backups para serviços externos pelo app.

## Download

Baixe a versão mais recente pela página de Releases do GitHub.

Arquivo recomendado:

```text
KPassword-Setup-v1.3.3.exe
```

Também são publicados junto ao release:

```text
KPassword-Setup-v1.3.3.exe.sig
latest.json
SHA256SUMS.txt
```

O arquivo `latest.json` é usado pelo atualizador automático do app. O arquivo `SHA256SUMS.txt` serve para conferência de integridade dos arquivos publicados.

## Como instalar

1. Baixe o instalador da versão mais recente em Releases.
2. Execute `KPassword-Setup-v1.3.3.exe`.
3. Abra o KPassword.
4. Crie sua senha mestra.
5. Guarde a senha mestra com segurança, pois ela não pode ser recuperada.

## Segurança em uma frase

O KPassword salva seus dados localmente em um cofre criptografado. O app não exige nuvem, servidor externo ou conta online para guardar suas senhas.

## Recursos principais

- Cofre local criptografado com senha mestra.
- Backups criptografados `.kpvault`.
- Verificação de backup sem restaurar o cofre atual.
- Credenciais, notas seguras, cartões, identidades e licenças.
- TOTP/2FA opcional dentro da credencial.
- Leitura local de QR Code por imagem ou recorte do Windows, sem salvar screenshot em disco.
- Assistente do Cofre com próximas ações sugeridas.
- Diagnóstico de senhas fracas, reutilizadas, antigas, vencidas ou sem 2FA.
- Histórico de ações do cofre, sem armazenar senhas, TOTP, anexos ou valores sensíveis.
- Tags, busca e filtros rápidos.
- Importação CSV com prévia.
- Exportação CSV para migração, com aviso de risco.
- Windows Hello/PIN/biometria como desbloqueio rápido opcional no dispositivo.
- Atualização via GitHub Releases com assets assinados.
- Inicialização com Windows opcional, registrada como KPassword.
- Interface com temas escuro, claro e misto.

## Segurança e privacidade

O KPassword protege o cofre em repouso no computador local. A senha mestra é necessária para abrir o cofre e não pode ser recuperada pelo projeto.

O desbloqueio com Windows Hello é uma conveniência local protegida pelo contexto Windows/DPAPI do usuário. Ele não substitui a senha mestra e não deve ser entendido como segundo fator separado.

Guardar senha e 2FA no mesmo cofre aumenta a praticidade, mas reduz a separação entre fatores. Quem quiser maior separação pode manter o TOTP em um autenticador separado.

Arquivos CSV exportados não são criptografados. Use CSV apenas para migração temporária e apague o arquivo com segurança depois do uso. Para backup, use `.kpvault`.

O Histórico de Ações registra apenas eventos operacionais seguros, como credencial criada, senha copiada, cofre bloqueado ou configuração alterada. Ele não registra senhas, códigos TOTP, anexos, valores antigos, valores novos ou conteúdo sensível.

## Tecnologias usadas

- Tauri 2.
- React 19.
- TypeScript.
- Rust.
- Vite.
- CSS.
- PowerShell para automação de build, release e validação.

## Build local

```powershell
cd C:\Projetos\KPassword
npm install
npm run build
```

Build oficial de release:

```powershell
powershell -ExecutionPolicy Bypass -File ".\tools\fix-updater-v030-build.ps1" -Version "1.3.3"
npm run release:hash -- --ReleaseDir ".\dist-release\v1.3.3"
npm run release:validate -- --ReleaseDir ".\dist-release\v1.3.3"
```

O script de build assinado não faz `git add`, `git commit`, `git push` nem instala dependências automaticamente. Antes da release, confira o estado do Git, rode `npm install` manualmente quando necessário e use uma chave privada do updater protegida por senha forte.

## Assets de release

Publique apenas estes arquivos no GitHub Release:

- `KPassword-Setup-v<versao>.exe`
- `KPassword-Setup-v<versao>.exe.sig`
- `latest.json`
- `SHA256SUMS.txt`

Não envie arquivos auxiliares locais, zips de patch, scripts aplicadores temporários ou pastas de build.

## Documentação

A documentação técnica fica na pasta `docs/`.

Arquivos úteis:

- `docs/ARCHITECTURE.md`: visão da arquitetura.
- `docs/SECURITY.md`: notas de segurança.
- `docs/USER_GUIDE.md`: guia de uso.
- `docs/QA_CHECKLIST.md`: checklist de testes.
- `docs/RELEASE_CHECKLIST.md`: checklist de publicação.
- `docs/MAINTENANCE.md`: manutenção do projeto.
- `docs/VAULT_DIAGNOSTIC.md`: diagnóstico do cofre.

Arquivos antigos de patch/hotfix podem ficar arquivados em `docs/archive/` e `tools/archive/` para manter a raiz do repositório limpa.
