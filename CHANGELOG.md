# Changelog

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
