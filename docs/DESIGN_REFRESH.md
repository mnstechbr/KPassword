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

## Correção após o teste visual do usuário

A entrada ocupa a janela sem cartão externo, borda ou moldura de aplicativo.
Configurações usa abas de aparência/idioma, aplicativo/cofre e manutenção/ajuda.
Backups usa abas de armazenamento, backups/recuperação e importação/exportação,
com os mesmos controles de navegação de Segurança. Todas as opções anteriores
continuam disponíveis; os painéis inativos ficam ocultos sem apagar seu estado.
A troca de página ou aba volta ao início da área de conteúdo.

Foram corrigidas interferências do CSS histórico no posicionamento do conteúdo
e no menu em 800 px, no título em 360 px, nas dimensões dos botões de navegação,
na largura e direção da Lixeira e na decoração da primeira criação. Os campos
de edição usam duas colunas em telas maiores e uma em telas estreitas. Ajuda e
prévia CSV perderam superfícies internas desnecessárias; menus ficam abaixo dos
diálogos.

Verificação desta correção, com comandos nativos simulados e dados fictícios:

| Área | Inspeção |
| --- | --- |
| Seis páginas principais | Capturas em 360, 800, 1120 e 1440 px; medição da largura de conteúdo e interseção entre botões |
| Tema claro e fonte maior | Todas as seis páginas em 800 px; correção adicional da Lixeira após inspecionar as capturas |
| Navegação | Menu aberto/recolhido, todas as abas de Segurança, Configurações e Backups |
| Itens | Seis tipos de formulário em 360 px e detalhes em 800 px; detalhes ao lado da lista em 1440 px |
| Diálogos | Histórico, diagnóstico, 2FA manual, prévia CSV com arquivo de exemplo, aviso de exportação, novo cofre e restauração |
| Entrada | Desbloqueio e primeira criação em 1120/360 px; retirada da decoração que gerava transbordamento horizontal |
| Secrets Bridge | Janela de 440 × 620 px, incluindo identidade expandida, sem aprovar pedidos |

Nos cenários medidos das páginas principais e formulários não houve interseção
entre botões nem largura de rolagem maior que a área disponível. Capturas e
medições temporárias ficam em `/tmp/kpassword-visual-qa`. O build e os 140 testes
passaram novamente; permanece o aviso de tamanho de chunks. Esta inspeção não
certifica a janela nativa, desempenho WebKitGTK/WebView2 ou funções de integração
com o sistema. O teste no aplicativo real continua necessário antes do push.

### Ajuste da altura na criação de cofre

A criação deixou de herdar áreas nomeadas do grid antigo. O guia fica em uma
faixa abaixo das duas colunas, com logo e espaçamentos menores somente nessa tela.
A tela de desbloqueio permanece igual. Na prévia isolada, a criação coube sem
rolagem horizontal ou vertical em 1120 × 720, 1120 × 680, 1024 × 600,
1440 × 900 e 800 × 720; o desbloqueio foi reconferido em 1120 × 720.
Em larguras de até 680 px, os elementos continuam empilhados e a rolagem vertical
permanece disponível para acessar todos os campos e avisos.

### Menu após recolher e expandir

O menu vertical usa Flexbox em coluna, com alinhamento inicial e itens que não
crescem para preencher a altura. Isso evita o dimensionamento de linhas do grid
dentro da coluna flexível da barra lateral. As propriedades antigas de grid são
neutralizadas; a altura mínima antiga de 28 px dos ícones também foi substituída
por 20 px, mantendo os botões em 44 px na fonte padrão. Até 680 px, a navegação
permanece horizontal.

O alongamento observado no print nativo não foi reproduzido na prévia Chromium.
Após a mudança, foram conferidos recolher/expandir em 1440, 1120, 800 e 700 px,
a transição para 640 px e o retorno a 1120 px, com altura de 720 px. A sequência
também passou em 800 px com fonte maior, sem rolagem na barra lateral. O build
passou. É necessário repetir a sequência no WebKitGTK do aplicativo real para
confirmar a correção do comportamento específico mostrado pelo usuário.

### Limpeza da navegação e alternância rápida

A transição de 180 ms da largura da grade foi retirada: os rótulos eram exibidos
imediatamente enquanto a coluna ainda crescia, permitindo quebra de texto e
aumento temporário dos botões. A abertura agora aplica largura e rótulos juntos;
as transições de cor dos controles continuam disponíveis.

Foram removidos 264 seletores de navegação do CSS legado, eliminando 129 regras
inteiras e mantendo os demais seletores das regras compartilhadas. Também foram
retirados os blocos obsoletos do menu responsivo de 980 px e seus comentários.
`src/design.css` é a única fonte de estilos específica do menu. A limpeza é
limitada à navegação; outros fluxos ainda têm estruturas na camada `legacy`.

Na prévia, 40 alternâncias consecutivas em 1120, 800, 700 e 1440 px mantiveram
os botões em 44 px, sem transição de largura e sem rolagem na barra lateral.
Foram reconferidos o menu horizontal em 360 px, o tema claro e a navegação nas
seis páginas principais. Os 140 testes passaram novamente e o build passou.
A confirmação do efeito transitório no WebKitGTK continua sendo feita no app
nativo pelo usuário.

### Animação estável e troca de páginas

O menu recebeu uma nova transição de 200 ms. Rótulos e marca ficam posicionados
fora do fluxo, com largura fixa, sem quebra de linha, e são recortados enquanto
a coluna se move. Os ícones mantêm sua posição e os botões sua altura. Com fonte
maior, a largura expandida aumenta para 240 px para mostrar os nomes completos.
Isso substitui a transição anterior, que permitia refluência do texto.

As páginas deixam de entrar com opacidade zero: usam somente um deslocamento
discreto, com conteúdo opaco desde o primeiro quadro. O espaço da barra de
rolagem é reservado nos runtimes que suportam `scrollbar-gutter`. O retorno ao
topo usa `useLayoutEffect` para acontecer antes da pintura, evitando um quadro
na posição de rolagem anterior. Diálogos mantêm sua animação própria.

Na prévia isolada, foram feitas 32 alternâncias em quatro larguras, com botões
de 44 px, sem transbordamento no menu. As seis páginas mantiveram opacidade 1
e largura sem transbordamento. A fonte maior preservou nomes completos, sem
quebra de linha. Com redução de movimento ativada, a duração foi 0 s e a
animação da página foi desativada; a troca a partir de uma área rolada voltou
ao topo. A navegação horizontal em 360 px foi reconferida. A percepção visual
final no aplicativo nativo continua sujeita ao teste do usuário antes do push.

### Revisão geral e limpeza após a validação visual

Os resíduos demonstráveis do CSS, traduções e assets antigos foram removidos,
sem retirar funções. A análise e as verificações estão registradas em
[CODE_CLEANUP.md](CODE_CLEANUP.md). A camada estrutural ainda usada por estados
especializados permanece; não houve remoção indiscriminada de estilos ativos.
