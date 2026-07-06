# Checklist de release segura

Antes de publicar uma release do KPassword:

## Validação local

- [ ] `npm run build`
- [ ] `npm run release:hash -- -ReleaseDir ".\dist-release\v<versao>"`
- [ ] `npm run release:validate -- -ReleaseDir ".\dist-release\v<versao>"`
- [ ] `cargo check` em `src-tauri`
- [ ] `cargo test` em `src-tauri`
- [ ] `cargo clippy` em `src-tauri`
- [ ] `npm run security:audit`
- [ ] `npm audit`
- [ ] `cargo audit`, se instalado

## Testes manuais

- [ ] teste manual completo do app instalado ou em ambiente local equivalente;
- [ ] abrir cofre existente;
- [ ] testar senha mestra errada;
- [ ] criar, editar e excluir credencial de teste;
- [ ] testar backup manual;
- [ ] testar restauração de backup;
- [ ] testar arquivo `.kpvault` inválido;
- [ ] testar bloqueio por inatividade;
- [ ] testar limpeza do clipboard;
- [ ] testar updater a partir da versão anterior instalada.

## Release GitHub

- [ ] tag SemVer limpa, por exemplo `v0.9.1`;
- [ ] não usar tags como `fix`, `v0.8.0fix` ou similares;
- [ ] anexar instalador `.exe`;
- [ ] anexar `.sig` correto;
- [ ] anexar `latest.json`;
- [ ] anexar `SHA256SUMS.txt`;
- [ ] validar assets locais com `tools\validate-release-assets.ps1`;
- [ ] conferir se `latest.json` aponta para a tag correta;
- [ ] marcar como latest release quando apropriado.
- [ ] validar o site oficial após a release, incluindo a página "Verificar download".

## Segurança operacional

- [ ] não commitar chave privada de assinatura;
- [ ] não commitar cofres `.kpvault`;
- [ ] não commitar backups reais;
- [ ] revisar `git status --short`;
- [ ] revisar `git diff --stat`;
- [ ] confirmar que não há mojibake em arquivos com acentos.
