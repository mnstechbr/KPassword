# Manutenção do Projeto

## Versão

Sempre manter sincronizado:

- `package.json`
- `package-lock.json`
- `src-tauri/tauri.conf.json`
- `APP_VERSION` em `src/App.tsx`

## Scripts principais

Scripts essenciais:

```text
tools/fix-updater-v030-build.ps1
tools/fix-updater-v030-build.cjs
tools/generate-release-checksums.ps1
tools/validate-release-assets.ps1
```

Scripts auxiliares:

```text
tools/audit-project.ps1
tools/release-version.ps1
```

Scripts antigos de hotfix devem ficar arquivados em:

```text
tools/archive/
```

## CSS

O `App.css` acumulou vários hotfixes durante o desenvolvimento. Como o visual atual está validado, qualquer limpeza de CSS deve seguir esta regra:

1. Não remover blocos sem comparar tela por tela.
2. Testar Escuro, Claro e Misto.
3. Testar login, cofre, analítico, segurança, configurações e popups.
4. Testar modo compacto.
5. Só então consolidar estilos duplicados.

## Dependências

Antes de atualizar dependências:

```powershell
npm run build
npm run tauri dev
```

Depois de atualizar:

- Testar build.
- Testar instalador.
- Testar updater.
- Gerar `SHA256SUMS.txt` e validar assets antes de publicar release.
- Testar Windows Hello/PIN/biometria.
- Testar bandeja.

## Chaves

Nunca versionar chave privada do updater.

Também não versionar `.env`, `*.key`, `*.pem`, cofres `.kpvault`, arquivos `.kphello` ou backups reais.
