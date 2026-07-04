KPassword - Refino 3 da tela de login sem alterar versão

Arquivos alterados:
- src/App.tsx
- src/App.css

Objetivo:
- Corrigir o seletor de idioma para não ficar maior que os demais controles.
- Centralizar as opções PT, EN, ES e TR no dropdown customizado.
- Alinhar a frase "COFRE BLOQUEADO, digite a senha/PIN para desbloquear" com o mesmo eixo do campo e botões.
- Remover o quadrado atrás da logo.
- Substituir o bloco de fundo por duas linhas verticais atrás da logo, simulando um portão abrindo para os lados.
- Equalizar o espaçamento do topo entre tema, botões centrais e idioma.

Este patch não altera package.json, tauri.conf.json ou número de versão.
