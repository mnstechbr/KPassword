KPassword v0.6.0 - Polimento responsivo e auditoria visual

Ajustes principais:
- Versão ajustada para 0.6.0 em App.tsx, package.json, package-lock.json, tauri.conf.json, Cargo.toml e Cargo.lock.
- Janela Tauri com minWidth/minHeight reduzidos para permitir teste real de responsividade.
- Camada global de design system CSS com variáveis, espaçamento e containers flexíveis.
- Correção de variáveis CSS usadas em recursos recentes: --card, --border, --muted.
- Layout mais robusto para desktop, janela estreita, tablet e base futura mobile/web.
- Menu lateral vira navegação inferior em larguras menores.
- Cards, grids, modais, formulários e botões com largura fluida.
- Modais com max-height e scroll interno controlado.
- Botões e textos longos com quebra segura para PT/EN/ES/TR.
- Lista de itens convertida para layout tipo card em telas menores.
- Configurações, Segurança & backup, Importação/exportação, multi-cofres, TOTP e Windows Hello com proteção de layout.
- Removido um bloco duplicado de scrollbar no CSS.

Como aplicar:

$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v060-polimento-responsivo*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
