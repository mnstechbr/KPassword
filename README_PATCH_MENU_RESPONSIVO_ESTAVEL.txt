KPassword - Patch menu responsivo estavel v0.8.3

Este patch ajusta somente o menu interno do app.

Objetivo:
- Manter menu lateral aberto/fechado apenas quando houver largura para caber na lateral.
- Em largura estreita, forcar uma unica posicao: barra inferior horizontal.
- Em barra inferior, ocultar labels e mostrar apenas icones.
- Em barra inferior, neutralizar o clique do botao/logo de abrir/fechar menu.
- Remover a etapa intermediaria onde o menu aparecia em cima e depois ia para baixo.

Arquivos alterados:
- src/App.tsx
- src/App.css

Nao altera versao, package.json, tauri.conf.json ou tela de login.
