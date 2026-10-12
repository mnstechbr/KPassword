# Revisão e limpeza do código — 11/10/2026

## Escopo e critério

Revisão do estado atual do frontend, incluindo alterações da repaginada e resíduos
mais antigos: imports, módulos, classes estáticas e dinâmicas, CSS, temas,
traduções, assets e integrações Tauri. Também foram conferidos os avisos da
compilação nativa e executadas as suítes de ferramentas auxiliares.

A limpeza remove apenas referências comprovadamente sem consumidores. Não altera
criptografia, formatos de cofre, comandos IPC, políticas de aprovação ou funções
do aplicativo. O TypeScript continua com `noUnusedLocals` e
`noUnusedParameters`; a análise de imports não encontrou módulos de implementação
isolados. `vite-env.d.ts` é uma declaração de ambiente, não um módulo executável.
O worker e o leitor de QR continuam necessários.

## Resíduos removidos

- 347 regras completas e 656 seletores de `App.css`: telas analíticas antigas,
  troca de cofre no aplicativo desbloqueado, configurações avançadas antigas,
  drag-and-drop antigo e seletores baseados na classe `theme-light` que não é
  mais produzida. Seletores compartilhados com componentes ativos foram mantidos.
- Cinco regras completas e 32 seletores sem consumidores em `design.css`, mais a
  alternativa `successBadge` em um seletor `:where`, preservando as demais
  alternativas. Total: 689 seletores sem uso.
- A animação `dashboardMoreIn`, cujo componente já não existe, e delimitadores de
  hotfix históricos que não descreviam mais os blocos mantidos.
- 26 propriedades CSS personalizadas sem leituras no CSS ou no frontend, em 28
  declarações. Regras que ficaram vazias foram descartadas.
- Oito entradas de tradução do tema misto em quatro idiomas. A migração de
  preferências antigas para Sistema e seus testes permanecem.
- Três imagens de scaffold sem referências: React, Vite e Tauri. O ícone oficial
  do aplicativo permanece.

A transformação por AST preservou declarações, ordem e contexto das regras
retidas. Classes interpoladas como `tone-*`, `issue-*` e `totpEasyModal--*` foram
preservadas; classes em negações e alternativas não foram tratadas como prova
isolada de que um seletor inteiro não pode corresponder. Uma nova varredura não
identificou classes CSS ausentes dos consumidores considerados.

O helper de execução do Windows Hello passa a compilar somente no Windows. Nos
três comandos que recebem um `AppHandle` usado somente no Windows, o argumento é
explicitamente consumido no caminho de indisponibilidade das outras plataformas.
Nomes, argumentos e resultados dos comandos permanecem iguais. Isso elimina os
quatro avisos anteriores de código/variáveis sem uso no Linux.

A compilação de produção revelou também que `Core::authorize` e a coleção de
integrações armazenada em `Key` só são lidas pelas fixtures do antigo modo de
entrega. Esses dois elementos passam a existir somente com `cfg(test)`. A leitura
e a validação de `apiApplications` permanecem na produção, incluindo o limite de
32 integrações; as permissões reais continuam no broker de chamadas. Nenhum
comando ou caminho de autorização em uso foi removido.

## Validação

- `npm test`: 140 testes em 10 arquivos, incluindo os 29 testes existentes das
  ferramentas de versão e assets de release. Nenhuma configuração extra é
  necessária para descobri-los.
- `npm run build`: TypeScript e bundle aprovados. CSS compilado reduzido de
  257,71 KB para 215,68 KB; esta medida não é um benchmark de fluidez.
- `npm run version:check`: sete fontes concordam em 1.5.2.
- `cargo test --locked --offline --lib --manifest-path src-tauri/Cargo.toml`:
  82 testes aprovados no Linux, incluindo compatibilidade de cofres antigos.
  Os casos de sockets locais foram executados fora do sandbox que os bloqueava,
  usando as fixtures dos testes, sem cofres reais.
- `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml`:
  compilação Linux conferida.
- Ferramentas Python: oito testes do cliente Bridge, seis do proxy Claude e um
  teste de publicação simulada aprovados; sem publicação de release.
- Prévia isolada com comandos Tauri simulados: seis páginas principais, abas de
  Segurança, Backups e Configurações, temas claro/escuro, criação de cofre,
  navegação em 360 px e popup Bridge em 440 × 580 px. Páginas principais sem
  transbordamento horizontal; botões laterais mantêm 44 px de altura.
- `git diff --check` limitado aos arquivos desta limpeza.

## Limites e preservações

O CSS estrutural ainda utilizado por estados de QR, CSV, Assistente, detalhes e
formulários permanece na camada `legacy`. A presença de uma regra histórica ou de
um override ativo não basta para removê-lo. Não se afirma que toda redundância
possível do repositório foi eliminada; a revisão remove os resíduos demonstráveis
sem reescrever os fluxos que o usuário acabou de validar.

Permanece o aviso preexistente do Vite sobre chunks JavaScript acima de 500 KB.
A prévia não substitui testes de WebKitGTK/WebView2, bandeja, captura, clipboard ou
Windows Hello em máquinas reais. A CI do pull request verifica também Windows e
Fedora. Alterações locais preexistentes em arquivos de patch e no ícone macOS
não fazem parte desta limpeza nem do push.
