# Repaginada visual — validação local

## Escopo

Interface compartilhada entre Fedora e Windows: temas claro, escuro e sistema;
menu recolhível com o ícone oficial; cabeçalho e conteúdo usando a largura disponível;
campos, botões, tipografia e espaçamentos padronizados; menos superfícies aninhadas.
Em telas amplas, os detalhes do item ficam ao lado da lista. Em telas menores,
abrem em diálogo com foco de teclado contido e devolvido ao fechar.

O tema misto anterior passa a acompanhar o sistema. As preferências existentes de
fonte, movimento e densidade continuam sendo lidas. A aparência da janela nativa
também acompanha a escolha. O Secrets Bridge usa a mesma aparência e mantém
contagem regressiva, identidade completa, aprovação única, limite de chamadas e
regras existentes. Seu conteúdo rola separadamente dos avisos e ações.

## Organização das funções

| Destino | Conteúdo |
| --- | --- |
| Tela inicial | Criar/selecionar cofre, desbloquear, restaurar backup, ajustes rápidos |
| Cofre | Pesquisa, filtros, tags, ordenação, favoritos, todos os tipos de item, detalhes e edição |
| Assistente | Sugestões, fila de ações, diagnóstico e acesso ao 2FA |
| Lixeira | Restaurar e excluir itens, limpar lixeira |
| Segurança — Acesso | Senha mestra e desbloqueio pelo sistema |
| Segurança — Bloqueio | Inatividade e minimizar |
| Segurança — Área de transferência | Limpeza automática e explicação do histórico do sistema |
| Segurança — Integrações | Secrets Bridge, sessão e permissões, onde já suportado |
| Backups e dados | Armazenamento, pastas, frequência, criar/verificar/restaurar backup, importação e exportação |
| Configurações | Aparência, acessibilidade, idioma, bandeja, autostart, notificações, som, atualizações, ajuda, histórico, diagnóstico e exclusão do cofre |

A troca/criação de cofre fica somente na tela inicial. Configurações permite
bloquear para voltar à seleção. Nenhum comando nativo foi retirado do App.tsx;
as entradas duplicadas de seleção/criação no aplicativo desbloqueado foram
substituídas por esse caminho. Criptografia e formatos do cofre não foram alterados.

## CSS antigo

`src/design.css` define os tokens e a apresentação atual. `src/App.css` fica na
camada `legacy`, abaixo do novo sistema, sem `!important` e sem seletores do tema
misto. Ainda conserva regras estruturais de fluxos especializados, como QR,
prévia de CSV e estados do Assistente. Não representa uma eliminação completa
do CSS histórico; a remoção adicional deve acompanhar testes desses estados.

As animações são curtas e respeitam redução de movimento do aplicativo e do SO.
A profundidade vem de bordas, iluminação discreta e sombras; não há cena WebGL,
animação contínua ou dependência gráfica nova.

## Verificações realizadas

- `npm run build`: TypeScript e bundle de produção.
- `npm test`: 140 testes em 10 arquivos, incluindo migração de tema e resolução do tema do sistema.
- `cargo check --manifest-path src-tauri/Cargo.toml --offline`: integração compilada no host Linux; avisos preexistentes permanecem.
- `git diff --check` limitado aos arquivos da repaginada.
- Prévia no navegador com comandos Tauri simulados, dados fictícios e arquivos temporários fora do repositório. Nenhum cofre real foi criado/modificado pela prévia.
- Inspeção visual em 360, 520, 1120 e 1440 px, temas claro/escuro, menu aberto/recolhido, todas as páginas principais, tela inicial e primeira criação.
- Inspeção dos seis tipos de formulário, detalhes, 2FA, criação de cofre, histórico, diagnóstico, exportação CSV e Secrets Bridge com limite/identidade expandidos.
- Sem transbordamento horizontal nas páginas principais inspecionadas em 1120 px; correção e inspeção do posicionamento do menu/conteúdo em 360/520 px.

O Vite ainda avisa sobre o tamanho de chunks existentes. Não foi feito benchmark
de GPU, memória ou fluidez em WebKitGTK/WebView2. As verificações do navegador
não substituem os testes nativos de armazenamento, bandeja, clipboard, Windows
Hello, captura de QR, permissões da ponte e atualização do SO.

## Teste antes do push

Execute `npm run tauri dev` e use um cofre de teste. Confira maximizar/restaurar a
janela, menu, seis tipos de item, edição, anexos, histórico, 2FA, backups/CSV,
claro/escuro/sistema e fonte maior. No Fedora, confira bandeja, QR, clipboard e
janela real da ponte. No Windows, confira WebView2, Hello, autostart e bandeja.
Verifique também a mudança de tema do SO com o modo Sistema selecionado.

Entrega em commit local. Push, merge e publicação aguardam o teste do usuário.
