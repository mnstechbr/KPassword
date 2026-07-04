KPassword - Ajuste do icone da bandeja do Windows

Este patch cria um icone dedicado para a bandeja do sistema:
- src-tauri/icons/tray-icon.png

E atualiza src-tauri/src/lib.rs para usar esse icone no TrayIconBuilder, sem alterar o icone principal da janela/app.

Nao altera versao do app.
Nao mexe na tela de login.
Nao mexe no menu responsivo.
