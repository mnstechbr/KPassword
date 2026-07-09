# Changelog

## v1.3.3

Release de correção focada na substituição segura de 2FA e em ajustes de integração com o Windows.

### Segurança

- QR Code por imagem ou recorte do Windows continua salvando automaticamente quando a credencial ainda não tem 2FA.
- Quando a credencial já tem 2FA, um QR novo não substitui o segredo automaticamente. O app mostra a prévia do código e exige confirmação em Substituir 2FA.
- Mantido o processamento local do recorte do Windows, sem gravar screenshot em disco.

### Melhorias

- Adicionada opção em Configurações para registrar ou remover o KPassword dos Aplicativos de inicialização do Windows.
- Quando iniciado pelo Windows com `--startup`, o app abre direto na bandeja.
- Atualizado o título HTML para KPassword, reduzindo aparições de "Tauri + React + Typescript" em processos WebView2.
- Ao enviar para a bandeja, o app pede ao Windows para reduzir o working set do processo principal.

### Observação

- Processos filhos do WebView2 ainda podem aparecer como WebView2/Gerenciador WebView2 no Windows, pois pertencem ao runtime do WebView2.

## v1.3.2

Release de hardening preventivo após auditoria de segurança.

### Segurança

- Endurecido o fluxo de release/updater para não fazer commit, push ou instalação de dependências automaticamente.
- Removida a orientação de criar chave do updater sem senha; releases agora exigem chave local com senha forte.
- Adicionados limites de dimensão e quantidade de pixels no decoder QR Rust antes do processamento completo da imagem.
- Melhorado o gerador de senhas para usar rejection sampling e reduzir viés estatístico.
- Adicionado logging sanitizado no frontend para evitar despejo acidental de objetos de erro com dados sensíveis.
- Reduzido log operacional no Rust para não incluir detalhes desnecessários em falha de backup automático.

### Melhorias

- Exportação CSV reforça que o arquivo não é criptografado e deve ser apagado após a migração.
- Substituída a captura de QR estilo compartilhamento de tela por recorte do Windows, com minimização temporária, leitura local do clipboard e retorno automático do app.
- Auditoria local passa a mostrar dependências Rust que usam quick-xml para acompanhamento de advisories transitivos.
- Documentação de release e segurança reforçada para chave do updater, Windows Hello/DPAPI e ameaça local.

### Observação

- A atualização de quick-xml deve ser acompanhada via cargo audit/cargo tree. Não foi adicionado override manual inseguro de dependência transitiva.

## v1.3.0

Release focada em rastreabilidade local e organização das ações recentes do cofre, sem registrar dados sensíveis.

### Adicionado

- Adicionado Histórico de Ações em Configurações, dentro da área Segurança & backup.
- Adicionado popup/modal para visualizar eventos recentes do app.
- Histórico agrupado por data.
- Filtros por tipo de ação: Todos, Credenciais, Segurança e Sistema.
- Opção para limpar o histórico com confirmação.
- Registro de eventos importantes, como credencial criada, credencial editada, credencial enviada para lixeira, credencial restaurada, senha copiada, login/desbloqueio, bloqueio do cofre e alteração relevante em configurações.

### Segurança

- O histórico não armazena senhas, códigos TOTP, anexos, valores antigos, valores novos ou conteúdo sensível.
- Os eventos ficam salvos junto ao cofre criptografado.
- Não houve mudança no núcleo criptográfico nem quebra intencional de compatibilidade com cofres existentes.

### Experiência

- Configurações continuam limpas, com acesso ao histórico por botão.
- Modal compatível com janela menor e maximizada.
- Compatível com temas escuro, claro e misto.

## v1.2.0

Release focada em simplificar a interface sem adicionar telas novas nem alterar o formato do cofre.

- A lista do Cofre mantém as ações diretas visíveis, sem trocar botões úteis por menus extras.
- O detalhe da credencial preserva os botões já conhecidos e recebe apenas ajustes de hierarquia visual.
- A área **Segurança & backup** ficou mais leve: o uso diário fica visível e as opções sensíveis/raras ficam atrás de um único controle de opções avançadas.
- Senha mestra, verificação/restauração de backup, importação/exportação e ajustes finos aparecem juntos quando o usuário escolhe mostrar opções avançadas.
- O fluxo principal continua preservado: copiar, abrir site, criar backup e consultar backups seguem rápidos.
- O Assistente do Cofre recebeu ajuste de densidade visual: cards menores, menos altura vazia e destaque proporcional ao conteúdo.
- Configurações mantém um único controle para opções avançadas, com espaçamento mais compacto sem esconder ações frequentes.
- Não houve mudança no formato criptográfico, no updater, no armazenamento do cofre ou na compatibilidade de backups.

## v1.1.1

Release de correções pós-v1.1.0, focada em importação CSV, QR/TOTP e comportamento de backup.

- Corrigida importação CSV de TOTP quando a coluna contém URL `otpauth://`, evitando salvar a URL inteira como segredo inválido.
- Melhorado parser CSV para preservar campos entre aspas com quebra de linha, incluindo notas multilinha exportadas pelo próprio app.
- Adicionado limite de tamanho/dimensões antes de processar imagens de QR Code.
- A captura completa de tela usada para selecionar QR Code é descartada após leitura bem-sucedida do recorte.
- Ajustado salvamento do cofre para que falha de backup automático não faça a UI tratar uma gravação principal bem-sucedida como falha total.
- Texto do Windows Hello/DPAPI ficou mais explícito: é conveniência local, não substituto da senha mestra nem segundo fator separado.
- Removido fallback externo do arquivo vendorizado do leitor QR para reforçar funcionamento offline.

## v1.1.0

Release focada em uso mais simples do 2FA/TOTP e em transformar o diagnóstico do cofre em ações diretas.

### TOTP mais prático

- Adicionado fluxo **Adicionar 2FA** com importação de print/imagem contendo QR Code.
- Adicionada opção para selecionar QR Code na tela: o usuário escolhe a tela/janela, recorta a área do QR dentro do KPassword e confirma antes de salvar.
- A leitura do QR Code é feita localmente, sem envio de imagem para nuvem e sem salvar o print.
- Adicionada prévia obrigatória antes de preencher ou substituir o TOTP de uma credencial.
- Opção manual continua disponível como modo avançado/fallback.
- Corrigido fluxo de remover e adicionar novamente 2FA em credenciais existentes.
- A senha no cadastro/edição fica mascarada por padrão.

### Assistente do Cofre

- A tela de análise evolui para **Assistente do Cofre**, com foco em próxima ação recomendada em vez de relatório estático.
- Adicionada fila curta de ações priorizadas com atalhos para ver credencial, abrir site, editar, adicionar 2FA e filtrar problemas.
- Adicionadas sugestões de tags com confirmação antes de aplicar.
- Botões do Assistente foram validados e integrados ao padrão visual dos temas escuro, claro e misto.
- O Assistente não altera senhas, TOTP, anexos ou dados sensíveis automaticamente.

### Segurança e compatibilidade

- Não houve mudança no formato criptográfico do cofre.
- Não houve migração obrigatória do cofre.
- Backups criptografados anteriores continuam compatíveis.
- O KPassword continua local/offline, sem conta obrigatória e sem nuvem obrigatória.
- Guardar 2FA no KPassword é opcional e facilita o uso, mas mantém senha e código no mesmo cofre. Para maior separação entre fatores, use um autenticador separado.

## v0.9.5

Release focada em organização do cofre e importação/exportação CSV mais segura.

### Importação e exportação CSV

- Adicionado assistente de importação CSV com prévia antes de gravar no cofre.
- Adicionado mapeamento de colunas para nome, usuário/e-mail, senha, URL/site, notas, categoria, tipo, favorito, TOTP e tags.
- Adicionada validação de linhas antes da importação, com indicação de itens válidos, incompletos, inválidos e duplicados prováveis.
- Adicionado modal de importação CSV para evitar que a tela principal fique comprimida durante a prévia.
- Reclassificada a exportação CSV como recurso de migração, deixando claro que CSV não é criptografado.
- Adicionado aviso forte antes de exportar CSV, com confirmação explícita do usuário.
- Arquivos CSV exportados passam a usar nome com indicação de `NAO-CRIPTOGRAFADO`.

### Organização do cofre

- Adicionado suporte básico a tags nas credenciais.
- Tags podem ser editadas no cadastro e na edição de itens.
- Tags aparecem na lista e no detalhe das credenciais.
- A busca textual também considera tags.
- A importação e exportação CSV passam a preservar tags quando a coluna estiver presente.

### Filtros

- Adicionado dropdown de filtros rápidos na tela do Cofre.
- Filtros disponíveis incluem todos, favoritos, senhas fracas, reutilizadas, antigas, vencidas, próximas do vencimento, sem TOTP, incompletas e com tags.
- O filtro ativo aparece no próprio botão de filtros e pode ser limpo pelo menu.
- O layout do Cofre foi ajustado para manter busca, filtros e tags mais compactos.

### Observações

- Esta versão não altera o formato criptográfico do cofre nem o núcleo criptográfico.
- CSV continua sendo um formato legível e deve ser usado apenas para migração temporária. Para cópias de segurança, use backup criptografado.

## v0.9.4

Release focada em confiança operacional, diagnóstico e preparação segura de publicação.

### Confiança e release

- Adicionado validador local de assets de release para conferir instalador, `.sig`, `latest.json`, versão, URL do asset, assinatura e arquivos sensíveis antes da publicação.
- Adicionada geração de `SHA256SUMS.txt` para os assets públicos de release.
- Atualizados checklists para incluir `npm run release:hash`, `npm run release:validate`, `cargo check`, `cargo test`, `cargo clippy`, teste manual do app e validação do site oficial após a release.
- Documentação de arquitetura e segurança revisada para refletir o núcleo atual em Tauri/Rust e o fluxo real de release.

### Backup e diagnóstico

- Adicionada verificação de backup sem restaurar o cofre atual.
- Diagnóstico do Cofre passa a apresentar explicações e ações sugeridas para pontos que merecem revisão.

### Observações

- Esta versão não altera o formato do cofre nem o núcleo criptográfico.
- O site oficial ganhou uma página pública para orientar a verificação de download.


## [0.8.2] - Hotfix

### Correcoes
- Corrige contraste no tema Claro e Misto.
- Corrige botao de acesso por PIN na tela de login.
- Corrige botoes Restaurar e Excluir definitivamente na Lixeira.
- Corrige botoes de acao das credenciais no Cofre.
- Corrige botoes do detalhe da credencial.
- Corrige textos claros sobre fundo claro em listas, cards e modais.
## v0.8.1

Correções:
- Corrige lógica de inatividade quando o app já está na bandeja.
- Impede notificação duplicada de “inativo” depois que o app foi fechado/minimizado para a bandeja.
- Pausa o temporizador de inatividade quando a janela está oculta ou minimizada.
- Retoma o temporizador somente quando a janela volta a ficar visível.
- Ajusta a mensagem de inatividade para respeitar o tempo configurado.

Todas as mudanças relevantes do KPassword ficam registradas aqui.

## v0.8.0

Diagnóstico do Cofre e segurança percebida.

- Adicionado diagnóstico local do cofre na tela Analítico.
- Adicionada pontuação de saúde do cofre de 0 a 100.
- Adicionados alertas para senhas fracas, reutilizadas, antigas, vencidas e próximas do vencimento.
- Adicionado alerta para credenciais sem TOTP/2FA cadastrado.
- Adicionado alerta para credenciais incompletas.
- Cards do diagnóstico permitem filtrar o Cofre pelos itens problemáticos.
- Detalhe da credencial passa a exibir diagnóstico individual.
- Selo de risco exibido na lista de credenciais.
- Diagnóstico calculado localmente em memória, sem servidor e sem alterar a criptografia do cofre.
- Versão ajustada para `0.8.0`.

## v0.7.2

Manutenção, documentação e estabilidade do projeto.

- README refeito com visão real do KPassword.
- Adicionado guia de usuário.
- Adicionado checklist de QA.
- Adicionado checklist de release.
- Adicionadas notas de segurança.
- Adicionada visão de arquitetura.
- Adicionado guia de manutenção.
- Adicionada documentação da pasta `tools`.
- Adicionados scripts auxiliares de auditoria e release.
- Scripts antigos de hotfix passam a ser arquivados em `tools/archive` pelo script de limpeza.
- Versão ajustada para `0.7.2`.

Sem alteração funcional intencional no cofre, criptografia, layout, temas, PIN/biometria, TOTP, multi-cofres, backup ou updater.

## v0.7.1

Refino visual e experiência final.

- Tela de login redesenhada para uso real em desktop.
- Melhor uso da logo e identidade visual.
- Ajustes de tipografia.
- Melhorias nos temas Escuro, Claro e Misto.
- Correções de contraste em cards, botões, popups e telas.
- Modo compacto com cabeçalho menor.
- Menu da bandeja:
  - Abrir APP Completo.
  - Abrir APP Compacto.
  - Sair.
- Ajuste visual do ícone da bandeja.

## v0.7.0

Produto final, ajuda e revisão de experiência.

- Menu principal refinado:
  - Cofre.
  - Analítico.
  - Lixeira.
  - Segurança.
  - Configurações.
- Ajuda e Sobre unificados dentro de Configurações.
- Guia rápido mais enxuto.
- Termos mais claros para PIN/biometria do computador.
- Indicador visual do cofre atual.
- Analítico mais limpo.
- Botão de adicionar item compacto.
- Melhorias em dropdowns, popups e gerador.

## v0.6.1

- Correção do comportamento de minimizar/barra de tarefas.
- Windows Hello/PIN/biometria em primeiro plano via foco nativo HWND.
- Analítico compactado.
- Ajustes visuais menores.

## v0.6.0

- Polimento responsivo geral.
- Design mais flexível para desktop, futuro web e futuro mobile.
- Melhorias de responsividade.
- Dashboard/Analítico reorganizado.
- Correções visuais em telas menores.

## v0.5.2

- Hotfix de travamento do Windows Hello/PIN/biometria no app instalado.

## v0.5.1

- Desbloqueio opcional com Windows Hello/PIN/biometria.

## v0.5.0

- TOTP/autenticador 2FA.
- Multi-cofres locais.
- Login premium responsivo.

## v0.4.1

- Importação CSV.
- Exportação JSON criptografada.
- Exportação CSV aberta com confirmação da senha mestra.
- Anexos criptografados.

## v0.4.0

- Tipos de item:
  - Credencial.
  - Nota segura.
  - Cartão.
  - Identidade.
  - Licença/chave.
- Histórico de senhas.
- Restaurar senha anterior.

## v0.3.3

- Lixeira.
- Validade de senha.
- Dashboard/saúde do cofre.
- Gerador avançado.
- Configurações de segurança.

## v0.3.2

- Idioma global PT/EN/ES/TR.
- Detecção inicial do idioma do sistema.