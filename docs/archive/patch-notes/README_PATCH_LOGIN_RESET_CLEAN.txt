KPassword - Reset limpo da tela de login (v0.8.3, sem bump de versão)

Este pacote substitui App.tsx, App.css e i18n.ts por uma base limpa para remover os conflitos dos refinamentos anteriores.
Não altera package.json, tauri.conf.json, Cargo.toml nem versão do app.

Ajustes principais:
- Topo com tema à esquerda, ações do cofre no centro e idioma à direita, com espaçamento simétrico.
- Botão de idioma no mesmo porte visual dos controles, com opções centralizadas.
- Painel da senha mestra centralizado, sem elementos escapando para fora do container.
- Logo ao lado do painel, com animação de portão vertical atrás da logo.
- Créditos MNSTechbr no rodapé.
