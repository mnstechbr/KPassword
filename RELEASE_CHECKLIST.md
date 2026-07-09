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
- [ ] testar importação CSV com prévia, mapeamento e duplicados;
- [ ] testar exportação CSV para migração, incluindo aviso de arquivo não criptografado;
- [ ] testar tags em criar, editar, lista, detalhe e filtro;
- [ ] testar dropdown de filtros rápidos junto com busca e tags;
- [ ] testar TOTP por print/imagem com QR Code;
- [ ] testar seleção de QR Code na tela;
- [ ] testar remoção e recadastro de 2FA em credencial existente;
- [ ] testar Assistente do Cofre, botões principais e temas;

## Release GitHub

- [ ] tag SemVer limpa, por exemplo `v1.0.0`;
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
- [ ] chave privada do updater protegida por senha forte;
- [ ] scripts de release não fizeram git add/commit/push automático;
- [ ] não commitar cofres `.kpvault`;
- [ ] não commitar backups reais;
- [ ] revisar `git status --short`;
- [ ] revisar `git diff --stat`;
- [ ] confirmar que não há mojibake em arquivos com acentos.

## Validações específicas v1.2.0

- [ ] Cofre mostra ações principais sem poluição visual excessiva.
- [ ] A lista do Cofre mantém copiar usuário, copiar senha e editar como ações diretas.
- [ ] O detalhe da credencial mantém ações diretas sem menu extra desnecessário.
- [ ] Ações sensíveis continuam acessíveis ao abrir Mostrar opções avançadas em Segurança & backup.
- [ ] Seções expansíveis de senha mestra, backup, importação/exportação e segurança funcionam em temas escuro, claro e misto.
- [ ] App continua utilizável em janela menor e maximizada.
- [ ] Build oficial valida com Erros: 0 e Avisos: 0.

## Validações específicas v1.3.2

- [ ] Gerador de senhas testado em modo aleatório, memorável e PIN.
- [ ] Leitura de QR por imagem rejeita arquivos grandes.
- [ ] Leitura de QR visível na tela usa captura nativa local, minimiza o app temporariamente e volta automaticamente após a tentativa.
- [ ] Exportação CSV mostra aviso reforçado de arquivo não criptografado.
- [ ] `tools\fix-updater-v030-build.ps1` exige senha da chave e não faz commit/push.
- [ ] `npm run security:audit` mostra dependências que usam quick-xml e executa cargo audit quando instalado.

## Validações específicas v1.3.4

- [ ] QR novo em credencial sem 2FA salva automaticamente e mantém a tela do código aberta.
- [ ] QR novo em credencial com 2FA existente mostra aviso e exige Substituir 2FA antes de trocar.
- [ ] Recorte do Windows continua minimizando, voltando ao app e lendo o QR.
- [ ] Toggle Iniciar com Windows cria/remove entrada KPassword nos Aplicativos de inicialização.
- [ ] Ao iniciar com `--startup`, o app abre direto na bandeja.
- [ ] Título do WebView aparece como KPassword, sem "Tauri + React + Typescript".
- [ ] App enviado à bandeja bloqueia o cofre e não mantém dados sensíveis em estado desbloqueado.
