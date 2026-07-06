# Checklist de release segura

Antes de publicar uma release do KPassword:

## Validação local

- [ ] `npm run build`
- [ ] `npm run release:validate -- -ReleaseDir ".\dist-release\v<versao>"`
- [ ] `cargo check` em `src-tauri`
- [ ] `cargo test` em `src-tauri`
- [ ] `npm run security:audit`
- [ ] `npm audit`
- [ ] `cargo audit`, se instalado

## Testes manuais

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
- [ ] validar assets locais com `tools\validate-release-assets.ps1`;
- [ ] conferir se `latest.json` aponta para a tag correta;
- [ ] marcar como latest release quando apropriado.

## Segurança operacional

- [ ] não commitar chave privada de assinatura;
- [ ] não commitar cofres `.kpvault`;
- [ ] não commitar backups reais;
- [ ] revisar `git status --short`;
- [ ] revisar `git diff --stat`;
- [ ] confirmar que não há mojibake em arquivos com acentos.
