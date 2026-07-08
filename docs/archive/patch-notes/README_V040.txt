KPassword v0.4.0 - Tipos de item + histórico de senhas

Recursos adicionados:
- Tipos de item no cofre:
  - Credencial
  - Nota segura
  - Cartão
  - Identidade
  - Licença / chave de produto
- Migração automática dos itens antigos para tipo Credencial
- Formulário dinâmico conforme o tipo de item
- Lista e detalhe adaptados por tipo de item
- Histórico de senhas para credenciais
- Restaurar senha anterior
- Limpar histórico de senhas
- Textos novos em PT / EN / ES / TR
- Versão ajustada para 0.4.0

Como aplicar:
$Project = "C:\Projetos\KPassword"
$Zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "kpassword-v040-tipos-itens-historico*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Zip) { throw "ZIP não encontrado na pasta Downloads." }

Expand-Archive -Path $Zip.FullName -DestinationPath $Project -Force
cd $Project

npm run build
npm run tauri dev
