# KPassword para Fedora — validação do branch

Base: **1.4.1**, commit `77927c6545fbb70f7bde11d6f3b471af444ce962`.
Implementação em `feature/fedora-native`; não é uma release oficial.
Windows e Fedora compartilham React, TypeScript e o núcleo Rust do cofre.
Configurações/instalador/updater Windows originais permanecem; a configuração
adicional `src-tauri/tauri.linux.conf.json` é carregada somente no Linux.

## Build e instalação

No Fedora 44 KDE x86_64:

```bash
sudo dnf install rust cargo gcc gcc-c++ make pkgconf-pkg-config \
  gtk3-devel webkit2gtk4.1-devel libappindicator-gtk3-devel \
  librsvg2-devel openssl-devel patchelf
npm ci
npm test
npm run build
cargo test --locked --lib --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --ci --bundles rpm -- --locked
```

RPM: `src-tauri/target/release/bundle/rpm/KPassword-1.4.1-3.x86_64.rpm`.
O nome do pacote RPM é **k-password**, e o executável é `/usr/bin/kpassword`.
No ambiente desta implementação o cache Cargo temporário foi selecionado por
`CARGO_HOME=/tmp/kpassword-cargo-home`; o usuário pode usar seu cache normal.

```bash
sudo dnf install ./src-tauri/target/release/bundle/rpm/KPassword-1.4.1-3.x86_64.rpm
```

Para atualizar a partir de um RPM futuro validado, instalar o novo arquivo com
`sudo dnf upgrade ./KPassword-<versao>-<revisao>.x86_64.rpm`.
`sudo dnf upgrade k-password` só encontra atualizações se houver um repositório
RPM configurado; GitHub Releases por si só não é um repositório DNF.
Remoção: `sudo dnf remove k-password`.

O pacote instala binário, ícones, entrada `.desktop` e som em `/usr`; não inclui
cofres/configurações pessoais, scripts de instalação/remoção, serviço privilegiado
ou binário setuid. Dependências incluem GTK3, WebKitGTK 4.1, AppIndicator, xdg-utils,
Konsole, XWayland e XDG Desktop Portal/KDE. Cofres/backups ficam em
`$XDG_DATA_HOME/com.kpassword.app` (padrão: `~/.local/share/com.kpassword.app`).
Autostart opcional em `$XDG_CONFIG_HOME/autostart/com.kpassword.app.desktop`;
a remoção do RPM não apaga configurações pessoais ou essa preferência de autostart.

O updater NSIS assinado continua no Windows. No Linux, a interface orienta a
atualização via RPM; não tenta tratar o manifest Windows como atualização Linux.
O RPM de validação não está assinado. Publicação, assinatura e release não foram
executadas. Um build no Fedora 44 não promete compatibilidade glibc com Fedora
mais antigo: escolher e testar uma distribuição-base antes da release pública.

### NVIDIA no KDE/Wayland

A revisão 1 falhou na utilização interativa desta máquina (NVIDIA 615.71.09,
WebKitGTK 2.54.1): encerramento, corrupção visual e lentidão. O teste anterior
com janela oculta não detectou esses problemas e não serve como aprovação da GUI.
A revisão 2 seleciona XWayland, transporte SHM e pintura Skia por CPU antes de
inicializar GTK quando `/sys/module/nvidia` existe. São variáveis apenas do
processo; nenhuma configuração do desktop ou driver é alterada. Isso pode
aumentar o uso de CPU e precisa de validação em outras GPUs/configurações.
`KPASSWORD_GRAPHICS_PROFILE=native kpassword` desativa essa seleção para diagnóstico.
As variáveis WebKit já definidas pelo usuário têm precedência. Não combinar
essa revisão com as tentativas anteriores de desativar DMA-BUF/composição.

Formulários e confirmações Linux também recebem camadas acima dos controles de
idioma/menu, preservando o visual e as camadas originais do Windows.
Na revisão 3, a criação de cofre usa linhas que crescem conforme o conteúdo e
no mínimo 24 px entre o formulário e o guia; a margem negativa anterior causava sobreposição
quando os avisos de senha apareciam. O layout estreito usa linhas separadas.
O diálogo “Novo cofre” passa a ser renderizado também no aplicativo desbloqueado.
O header permanece no topo, na mesma posição da tela de desbloqueio. Quando os
avisos aumentam a altura, a criação permite rolar; o header não é centralizado
junto com todo o conjunto. O botão das configurações abre o diálogo quando o
campo do novo nome está vazio e mantém o fluxo anterior quando já está preenchido.

### Exclusão de cofre

Em **Configurações → Cofres → Excluir cofre**, a senha mestra do cofre selecionado
e uma confirmação são necessárias. O backend verifica a autenticação do arquivo,
grava uma cópia criptografada com os bytes originais, sincroniza e confere a cópia
antes de excluir o arquivo ativo. Falhas de autenticação ou backup preservam o
cofre. O Secrets Bridge é revogado. Um registro Hello existente fica desativado
junto da cópia, para não desbloquear um cofre futuro com o mesmo nome.

Os backups anteriores são mantidos. A cópia adicional fica em uma subpasta
`deleted-<data>-<contador>` da pasta de backups desse cofre; seu caminho é devolvido
após a exclusão. Para recuperar, use **Restaurar backup** e selecione o `.kpvault`
nessa subpasta, com a senha mestra original. A cópia não aparece na lista plana
de backups automáticos. Excluir não significa apagar definitivamente todas as
cópias: esse botão mantém a recuperação criptografada. Testes interativos usam
exclusivamente cofres fictícios em `/tmp`, nunca cofres pessoais.

## Cofres e autenticação

Não mudou o envelope `.kpvault`, Argon2id, AES-256-GCM, AAD ou suporte legado.
O arquivo `crypto_vault.rs` permanece sem alterações. Vetores v1/v2 independentes,
com UTF-8 e segredos fictícios, são testados pelo mesmo código no Fedora e Windows.
`tools/generate-vault-vectors.py` reproduz os vetores com argon2-cffi 25.1.0 e
cryptography 50.0.2 em ambiente de teste isolado. Nonces/salts fixos desses vetores
nunca são usados em produção.

Transferir somente uma cópia/backup criptografado para validar abertura no outro
sistema. O registro DPAPI/Windows Hello não é portátil. Windows Hello permanece
disponível no Windows; no Fedora esta versão exige **senha mestra**.

Desbloqueio Linux pelo sistema foi avaliado, mas não habilitado: PAM/Polkit não
protegem uma chave por si só, e KWallet/Secret Service já desbloqueados não dão
garantia de autenticação nova por entrega. Não foi criado helper privilegiado,
armazenada senha Linux ou implementado bypass da senha mestra. Essa é uma
limitação explícita desta implementação, não equivalência com Windows Hello.

## API Keys e Secrets Bridge

O modelo de 1.5.0 foi alterado para **chamadas sem exportação da chave**.
A aplicação adaptada pede uma operação pelo conector local; o KPassword mostra
executável/PID/hash, chave, provedor e operação. Aprovar permite a chamada HTTPS;
recusar ou não responder em 30 segundos impede a chamada. A aplicação recebe
somente a resposta. O inicializador experimental anterior foi desativado.

O conector Python faz parte do RPM em
`/usr/lib/KPassword/bridge/kpassword_bridge_client.py`. A integração requer
adaptação do aplicativo/projeto; não configura automaticamente Claude/Codex nem
SDKs OpenAI. Veja [instruções e limites](integrations/CLAUDE.md).

Nas configurações de segurança, permitir Secrets Bridge e ativar para a sessão.
A opção começa desabilitada; a senha mestra e o arquivo são verificados no backend.
“Continuar permitindo” vale para chave/executável/hash/operação na sessão atual.
Bloquear, salvar, restaurar, trocar o cofre ou encerrar o Bridge revoga novos
pedidos. Não pode desfazer chamadas já enviadas ao provedor.

O socket Unix fica no diretório privado `secrets-bridge` da pasta de dados do app,
com diretório 0700 e socket 0600. SO_PEERCRED verifica UID/PID; o executável é
consultado em `/proc` e seu SHA-256/start time são conferidos antes de chamar.
Nenhum nome informado pelo cliente é usado como identidade. Python/Node identificam
o interpretador, não o projeto nem plugins/scripts. Não há isolamento contra
malware da mesma conta, ptrace, root, captura de teclado ou frontend comprometido.
Copiar um arquivo de cofre criptografado não gera uma notificação.

Destinos HTTPS são fixos; o protocolo não aceita URLs/cabeçalhos do cliente.
Redirecionamentos e proxies de ambiente estão desativados. Pedido JSON limitado a
1 MiB, resposta a 4 MiB, leitura inicial com prazo absoluto, aprovação 30 segundos,
chamada 60 segundos. Streaming, uso remoto/VPS e senhas convencionais não suportados.
Não há API pública, servidor TCP nem alterações de `.bashrc` ou variáveis globais.

Histórico `bridge-audit.jsonl`: horário, resultado e IDs, sem chave/senha/conteúdo
das chamadas. Escrita 0600, sem symlinks, sincronizada antes da chamada; falha ou
limite de 10 MiB impede chamadas novas. “delivered” indica a resposta devolvida,
não autenticação bem-sucedida no provedor: respostas HTTP de erro também podem
ser recebidas. A autorização de sessão fica somente na memória e não muda o
formato criptográfico dos cofres.

Novos registros funcionam nas versões Windows/Fedora construídas deste branch.
Versões Windows anteriores podem abrir o envelope, mas não conhecem o novo tipo;
**não editar uma API Key em versões antigas**. CSV exporta tipo/provedor/identificador
e segredo mediante o aviso existente; importação CSV nunca concede permissões de
integração automaticamente. Backup/exportação criptografada preserva os campos.

## Validação e pendências

- Frontend: 137 testes aprovados, TypeScript e Vite aprovados.
- Rust Fedora: 63 testes aprovados (18 específicos do Bridge e 4 de exclusão segura), incluindo vetores independentes, backups,
  restauração, integridade, permissões, geração/expiração/revogação, IPC truncado/
  excessivo, chave exclusiva, ambiente limpo, substituição/tamanho de executável,
  cancelamento de ativação pendente por bloqueio e auditoria.
- RPM nativo gerado e conteúdo/dependências/scripts inspecionados.
- Na máquina real, revisão 2 com XDG temporário/cofre fictício: formulário e geração
  de senha exercitados, credencial salva e recuperada após reiniciar. Captura da
  própria janela conferiu fontes e camadas; rolagem automatizada produziu 191
  mudanças em 240 frames capturados a 60 Hz por quatro segundos. Essa medição
  limitada não comprova toda a experiência, nem substitui a avaliação do usuário.
- O fluxo de proteção para bandeja ocultou a janela e permitiu reabrir/desbloquear
  o cofre fictício. A notificação Linux foi chamada diretamente em uma thread
  comum: o plugin iniciava um runtime bloqueante dentro do Tokio e produzia panic.
  Depois da correção esse fluxo não produziu panic no teste nativo.
- Revisão 3 no binário nativo, sem injeção de CSS: criação com avisos de senha,
  header da criação/desbloqueio medido na mesma altura, guia separado e rolagem
  disponível; janela estreita com áreas separadas. “Novo cofre” abriu o diálogo
  na tela desbloqueada. Exclusão fictícia com senha errada foi recusada; com senha
  correta, preservou bytes exatos do backup e o outro cofre. Excluir o último
  cofre fictício retornou à criação.
- Instalação/upgrade da revisão 1 para revisão 2/remoção em banco RPM e prefixo temporários preservaram
  um arquivo sentinela de dados pessoais sintéticos. Dependências e scripts foram
  desabilitados nesse teste isolado; instalação real por DNF ainda precisa de QA.
  Inicialmente esse teste usou uma revisão temporária; agora a revisão 2 do
  repositório contém as correções gráficas. Atualização real por DNF e aprovação
  interativa do usuário ainda precisam de confirmação.
- CI mantém Windows e acrescenta Fedora 44: testes, build nativo, RPM e NSIS de
  validação. NSIS usa override temporário sem assinatura; configuração original de
  release/updater assinado não muda. Resultado do commit final será registrado
  após a execução remota.

Antes de aprovar uma release, validar interativamente, com cofre fictício:

1. Fedora KDE/Wayland: criar/abrir múltiplos cofres, CRUD de todos os tipos,
   busca/temas/responsividade, TOTP/QR importado e Screenshot Portal com cancelamento.
2. Clipboard: copiar chave, esperar limpeza, copiar conteúdo novo antes do prazo
   e confirmar que o app não o apaga. Configurar o histórico do Klipper: o app
   não consegue apagar cópias já armazenadas pelo gerenciador de clipboard.
3. Bandeja/fechar/minimizar/inatividade, janela compacta, notificação, som e autostart.
   Wayland restringe foco/janela e cliques de bandeja diferem; conferir no desktop.
4. Bridge: CLI real instalada + segredo fictício, confirmação/cancelamento,
   uma chave por integração, expiração, cofre fechado, revogação, rotação/alteração
   do executável, ausência de herança em outras janelas e leitura do histórico.
5. Instalação/upgrade por DNF em ambiente descartável, dependências, menu/ícone,
   preservação de um cofre fictício durante upgrade e remoção; validar também X11
   se for declarado suportado.
6. Windows em máquina de QA: NSIS, WebView2, Hello/DPAPI, clipboard, bandeja, som,
   autostart, updater assinado e troca de cofres fictícios com Fedora. CI não comprova
   funcionamento de biometria ou instalação interativa.

As seis alterações locais preexistentes continuam preservadas e fora dos commits.
Não houve reset/clean, merge, push em main, assinatura nem release. O relatório npm
da base indicou seis vulnerabilidades de dependências, ainda sem triagem; não foram
atualizadas automaticamente. Essas pendências impedem declarar aprovação final.
