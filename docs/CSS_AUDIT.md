# Auditoria inicial do CSS

O `src/App.css` tem aproximadamente 170,617 caracteres e acumulou várias camadas de ajustes/hotfixes durante a evolução visual do app.

## Decisão da v0.7.2

Não consolidar regras visuais automaticamente nesta versão.

Motivo: o visual da v0.7.1 foi validado manualmente. Remover overrides antigos sem uma suíte visual automatizada pode reabrir bugs de contraste, responsividade e modo compacto.

## Plano seguro para limpeza futura

1. Criar uma branch separada.
2. Separar CSS por áreas:
   - base
   - temas
   - login
   - layout desktop
   - layout compacto
   - modais
   - telas internas
3. Remover um grupo de overrides por vez.
4. Testar o checklist visual completo.
5. Só então publicar.

## Pontos de atenção

- Temas Claro/Misto.
- Popup Adicionar/Editar item.
- Login em menor resolução.
- Menu lateral fechado.
- Bandeja e modo compacto.
- Analítico.

## Blocos de hotfix detectados

Contagem aproximada de marcadores/comentários de hotfix: 96

Essa contagem é apenas orientativa e não representa erro.
