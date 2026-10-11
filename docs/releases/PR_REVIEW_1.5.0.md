# Revisão das pull requests para 1.5.0

Revisão feita sobre os commits das PRs abertas em 10/10/2026. A publicação depende
dos checks Windows/Fedora e da verificação local das assinaturas.

| PR | Decisão | Evidência / ressalva |
|---|---|---|
| #30 setup-node 7 | Incorporada | Diff restrito a Actions; CI, build Windows e CodeQL aprovados. |
| #20 CodeQL 4 | Incorporada | Atualizada com main sem force; todos os checks obrigatórios aprovados. |
| #18 React DOM 19.2.8 | Incorporada na branch Fedora | Lockfile também atualiza React para a versão correspondente; 137 testes e build passaram após npm ci. |
| #19 React 19.2.8 | Incorporada com resolução | O conflito com dependências zxcvbn foi resolvido mantendo-as; React/React DOM usam 19.2.8 juntos. Testes/build aprovados. |
| #2 checkout 7 | Incorporada na branch Fedora | Diff restrito a checkout de CodeQL/Scorecard; YAML válido. Validar novamente no CI da PR. |
| #16 Scorecard 2.4.4 | Incorporada na branch Fedora | Patch restrito à Action; permissões preservadas, YAML válido. Execução de Scorecard em main após merge. |
| #11 getrandom 0.4.3 | Incorporada na branch Fedora | 64 testes Rust passaram, incluindo vetores criptográficos e Bridge; conflito resolvido preservando GTK. |
| #13 Tauri 2.11.5 | Incorporada na branch Fedora | CI Windows/Fedora e instaladores aprovados no commit 7ac85cc; a mudança posterior do Bridge exige nova rodada antes do merge. |
| #8 PBKDF2 0.13 | Sem merge | Probe isolado reproduz erro E0277: digest/HMAC incompatível com SHA-256 0.10 atual. |
| #6 SHA-256 0.11 | Sem merge | Probe isolado reproduz erro E0277: CoreProxy incompatível com PBKDF2 0.12 atual. Atualizações de criptografia precisam ser coordenadas. |
| #10 windows 0.61.3 | Sem merge nesta Release | Mudança de bindings Windows usada por Windows Hello; falta validação dedicada. Preservado windows 0.58. |
| #12 TypeScript 7 | Sem merge nesta Release | PR antiga com conflitos; troca do compilador e artefatos nativos por plataforma precisa de migração e CI próprios. |
| #15 Vite 8 | Sem merge nesta Release | PR antiga com conflitos e mudança maior do bundler; precisa de migração coordenada com plugins/test runner. |
| #17 plugin-react 6 | Sem merge nesta Release | PR antiga com conflitos; atualização maior deve ser coordenada com Vite e verificada separadamente. |

A auditoria npm encontrou advisories nas ferramentas de desenvolvimento. Vitest
foi atualizado de 3.2.7 para 4.1.11 (correção oficial de GHSA-82fw-gwwq-j7x9),
mantendo Vite 7.3.6. Correções sem `--force` atualizaram Browserslist,
baseline-browser-mapping e source-map-js. A auditoria npm completa passou a
reportar zero advisories; 137 testes e build passaram com essas dependências.

PRs incorporadas através de merges na branch Fedora só entram em main quando a
PR multiplataforma passa pelos checks e é merged. Não foi usado force push,
reset, limpeza destrutiva ou inclusão das seis modificações locais preexistentes.
