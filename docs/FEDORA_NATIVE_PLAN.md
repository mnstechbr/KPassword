# Fedora nativo e Secrets Bridge — diagnóstico e plano

Este é o diagnóstico inicial. Implementação, comandos, testes concluídos e
limitações atuais estão em [FEDORA_NATIVE.md](FEDORA_NATIVE.md).

## Base e preservação

Auditoria em 10/10/2026. Base local: KPassword **1.4.1**, commit
`77927c6545fbb70f7bde11d6f3b471af444ce962`. A consulta à `main` do GitHub
retornou o mesmo commit. A pasta local continua sendo a fonte de verdade.
Branch de implementação: `feature/fedora-native`.

Antes da auditoria havia seis alterações locais, mantidas fora dos commits desta
implementação: cinco `.diff` em `docs/archive/patch-notes/` (diferenças somente
de finais de linha) e `src-tauri/icons/icon.icns` (conteúdo binário diferente,
mesmo tamanho; origem desconhecida). O ícone Windows `.ico`, os PNGs e o ícone
RGBA da bandeja correspondem aos bytes do commit-base.

Não substituir o projeto, mudar sua identidade visual, remover caminhos Windows,
alterar cofres reais, descartar alterações locais, publicar release ou fazer merge.
Commits/push somente no branch de implementação, com arquivos explicitamente
selecionados. Instaladores não entram no histórico.

## Arquitetura encontrada

- React 19 + TypeScript + Vite; interface, temas, idiomas e sessão em `src/App.tsx`.
- Tauri 2.11.3 no Cargo.lock; CLI 2.11.4 no package-lock.json.
- Rust: armazenamento, backups, restauração com cópia de segurança, bandeja,
  notificações, QR local e comandos em `src-tauri/src/lib.rs`.
- `crypto_vault.rs`: Argon2id, AES-256-GCM, AAD e compatibilidade PBKDF2 legado.
  `src/crypto.ts` chama o backend atual; não substituir por criptografia web.
- `PlainVault` e registros em `src/types.ts`; cinco tipos atuais: credencial,
  nota segura, cartão, identidade e licença.
- Windows Hello: UserConsentVerifier + DPAPI, sob `cfg(windows)`. Preservar esse
  caminho. Não transportar o registro DPAPI para Linux.
- NSIS, ferramentas PowerShell, updater assinado e workflows Windows existentes.
- CI da base: frontend, Rust em Windows e consistência de versões. O workflow
  foi ampliado para push em `feature/fedora-native` e execução manual, preservando
  os jobs existentes. O job Windows também compila o frontend e verifica o binário
  Rust em release com lockfile. YAML e invariantes dos jobs validados localmente;
  resultado no runner remoto ainda pendente.

## Matriz de compatibilidade inicial

“Compartilhado” descreve o código encontrado, não um teste de execução concluído.

| Funcionalidade | Windows existente | Fedora / ação necessária |
| --- | --- | --- |
| Temas, idiomas, layout, navegação, busca, favoritos, categorias, tags | Preservar | Compartilhado; validar WebKitGTK e responsividade |
| Credenciais, notas, cartões, identidades, licenças, histórico, lixeira | Preservar | Compartilhado; testar todos os fluxos |
| Gerador, avaliação de força, validade e diagnóstico de senhas | Preservar | Compartilhado; executar testes existentes |
| Argon2id, AES-GCM, AAD e leitura legada | Preservar sem alteração | Compartilhado; fixtures sintéticas idênticas nos dois sistemas |
| Multi-cofres, backups, verificação, restauração e troca de senha | Preservar | `app_data_dir()` já abstrai a plataforma; validar XDG e permissões |
| Importação/exportação CSV e criptografada; anexos | Preservar | Compartilhado; verificar arquivos, diálogos e round trips |
| TOTP e leitura de QR por imagem | Preservar | Compartilhado; testar leitor local e carregamento de WASM |
| Recorte de tela para QR | Snipping Tool + clipboard nativo | Implementar Screenshot via XDG Desktop Portal, com consentimento |
| Clipboard e limpeza temporizada | API do navegador atual | Validar WebKitGTK/Wayland; considerar plugin nativo com escopo mínimo |
| Auto-bloqueio, minimizar, fechar, inatividade e modo compacto | Preservar | Validar eventos Wayland e limpeza da sessão |
| Bandeja, notificações, som e single instance | Tauri/plugins existentes | Validar AppIndicator no KDE; clique esquerdo pode diferir |
| Abrir pasta/site | Explorer/rundll32 | `xdg-open` já existe; validar |
| Autostart | Registro HKCU + `--startup` | Adicionar entrada XDG Autostart; strings específicas de plataforma |
| Desbloqueio local | Windows Hello opcional | Ainda indisponível; exigir senha mestra até validação de proteção nativa |
| Atualização | NSIS + manifest assinado | RPM via gestor de pacotes; investigar updater Linux antes de habilitá-lo |
| Distribuição | Instalador `.exe` | Bundler RPM nativo do Tauri, configuração Linux independente |
| API Keys e Secrets Bridge | Não implementados | Adição opt-in, sem mudar envelope criptográfico |

## Segurança e decisões de implementação

A sessão desbloqueada atual e sua senha mestra são estado do React. O backend
expõe operações criptográficas, mas não mantém uma sessão autoritativa para
autorização externa. O Bridge não pode deduzir desbloqueio da existência de um
arquivo nem confiar apenas em uma flag do frontend.

Projetar sessão Rust com vínculo ao cofre ativo, geração de sessão, cancelamento
de pedidos e zeroização ao bloquear, trocar de cofre, restaurar ou fechar.
Inicialmente manter confirmação interativa para cada entrega de segredo.
Permissões persistentes ficam no payload cifrado, por integração e ID de chave;
nenhuma alteração no envelope, KDF ou AAD é necessária para campos opcionais.
Testar leitura/salvamento pela versão anterior antes de declarar compatibilidade
dos novos registros, inclusive comportamento de tipos desconhecidos.

UDS em diretório privado de `$XDG_RUNTIME_DIR`, diretório 0700 e socket 0600;
recusar diretórios inseguros, symlinks e colisões. UID/PID/executável são contexto,
não prova de identidade. Preferir lançamento controlado pelo app com canal
privado/capacidade curta por processo, chave e sessão; não publicar tokens em
argumentos, logs, arquivos ou ambiente global. Estabelecer protocolo limitado,
timeouts, proteção contra replay, revogação e auditoria sem valores sensíveis.
Revalidar autorização imediatamente antes da entrega, inclusive após confirmação.

O launcher só injeta a variável da chave aprovada no processo filho. Esse processo
e seus descendentes podem ler, registrar ou repassar a chave. Revogação impede
novas entregas, mas não recupera segredo já entregue. Malware com privilégios do
mesmo usuário permanece fora de uma promessa de isolamento absoluto.

Claude Code suporta `ANTHROPIC_API_KEY`, com regras próprias de precedência e
políticas administrativas. Não aplicar a mesma configuração ao Claude Desktop.
Para Codex, validar a versão alvo e o armazenamento de autenticação: existe
cache em `auth.json`/keyring e modo `ephemeral`; providers com `env_key` têm
regras distintas de `requires_openai_auth`. Não executar login que persista
segredos inadvertidamente nem presumir que exportar uma variável basta.

PAM/Polkit autenticam/autorizam ações; não protegem por si só uma chave de cofre.
Secret Service/KWallet podem já estar desbloqueados e não garantem nova
autenticação por entrega. Avaliar cadeia completa de armazenamento, autenticação
e liberação; não armazenar senha Linux nem derivar chave dela. Se a proteção
não for comprovável, manter desbloqueio Linux somente pela senha mestra e
documentar a limitação. Não instalar helper privilegiado sem revisão específica.

## Fases e verificações

1. **Auditoria:** registrar base, matriz, arquitetura, riscos e ambiente; manter
   alterações preexistentes fora dos commits. Este documento é o resultado inicial.
2. **Portabilidade:** instalar ferramentas; compilar a base nativamente; adicionar
   abstrações de plataforma, autostart XDG, clipboard e Screenshot Portal. Preservar
   cfg Windows e estilos. Rodar testes frontend/Rust e build Windows na CI.
3. **Autenticação:** avaliar armazenamento protegido e autenticação local; testar
   cancelamento, indisponibilidade, chave/cofre errado e ausência de bypass.
4. **Segredos:** API Keys como campos opcionais do payload, interface existente,
   busca por provedor, visualização explícita, clipboard protegido, permissões.
5. **Bridge:** sessão Rust, lançamento controlado, confirmação, IPC limitado,
   auditoria e revogação. Testar cofre bloqueado, chave errada, replay, cliente não
   autorizado, troca de cofre, bloqueio concorrente, revogação durante confirmação,
   desconexão, inputs malformados/grandes, timeouts e logs sem segredo fictício.
6. **Distribuição:** configurar RPM Linux, dependências e CI Fedora; gerar artefato
   fora do Git. Inspecionar `rpm -qpi/-qpl/-qpR/--scripts`; instalar, atualizar e
   remover em ambiente descartável e verificar preservação de dados. Sem release.

Fixtures criptográficas devem usar apenas segredos fictícios, transportados como
dados de teste textuais, sem cofres pessoais. Executar os mesmos vetores nos jobs
Windows/Fedora, para v1/v2, AAD, nonce, integridade, senha errada e restauração.
Build/teste Windows em Actions não substitui teste funcional do Windows Hello,
WebView2, clipboard, bandeja, NSIS e updater em máquina Windows.

## Ambiente e resultados iniciais

Fedora 44 KDE x86_64, sessão Wayland. Node 24.18.0, npm e rpmbuild disponíveis.
Rust/Cargo, gtk3-devel, webkit2gtk4.1-devel e libappindicator-gtk3-devel ausentes.
openssl-devel presente. `sudo -n dnf install ...` interrompeu com
`sudo: a password is required`; não houve instalação administrativa.

`node tools/version-check.mjs`: aprovado, sete fontes em 1.4.1. A primeira tentativa
de testes antes da instalação npm não executou a suíte por falta de Vitest.
`npm ci --ignore-scripts`: concluído mantendo o lockfile; npm reportou seis
vulnerabilidades nas dependências (duas moderadas, duas altas, duas críticas),
ainda sem triagem; não aplicar atualização automática que altere a base Windows.
`npm test`: sete arquivos e **124 testes aprovados**.
`npm run build`: TypeScript e Vite aprovados; aviso sobre chunks maiores que 500 kB.
Build Rust, RPM e validação funcional Windows/Fedora ainda pendentes.
O projeto ainda não atende aos critérios finais de aceitação.

Preparação do Fedora, em terminal do usuário (senha administrativa somente no
prompt local do sudo):

```bash
sudo dnf install rust cargo gtk3-devel webkit2gtk4.1-devel \
  libappindicator-gtk3-devel librsvg2-devel patchelf gcc gcc-c++ make \
  pkgconf-pkg-config
npm ci
npm test
npm run build
cargo test --locked --lib --manifest-path src-tauri/Cargo.toml
```

Depois das adaptações/configuração de empacotamento, validar o comando nativo
`npm run tauri -- build --bundles rpm`. Saída esperada do bundler:
`src-tauri/target/release/bundle/rpm/`. Nenhum RPM foi gerado nesta auditoria.

## Referências técnicas consultadas

- [Base atual no GitHub](https://github.com/mnstechbr/KPassword/commit/77927c6545fbb70f7bde11d6f3b471af444ce962).
- [Pré-requisitos Tauri/Fedora](https://v2.tauri.app/start/prerequisites/).
- [Bundler RPM e limites de compatibilidade glibc](https://v2.tauri.app/distribute/rpm/).
- [Screenshot Portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Screenshot.html).
- [Prompts Secret Service](https://specifications.freedesktop.org/secret-service/latest/prompts.html).
- [Autenticação Claude Code](https://code.claude.com/docs/en/authentication).
- [Autenticação Codex](https://developers.openai.com/codex/auth/).

Documentos locais considerados: `docs/ARCHITECTURE.md`, `CRYPTOGRAPHY.md`,
`docs/SECURITY.md`, configuração/capabilities Tauri e workflow CI.
