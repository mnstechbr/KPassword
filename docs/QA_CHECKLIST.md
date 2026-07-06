# Checklist de QA do KPassword

Use este checklist antes de publicar qualquer versão.

## 1. Primeiro uso

- [ ] Abrir o app sem cofre existente.
- [ ] Criar senha mestra.
- [ ] Confirmar senha mestra.
- [ ] Validar mensagem para senha fraca.
- [ ] Criar cofre com senha forte.
- [ ] Fechar e abrir novamente.
- [ ] Desbloquear com senha mestra.

## 2. Cofre

- [ ] Criar credencial.
- [ ] Criar nota segura.
- [ ] Criar cartão.
- [ ] Criar identidade.
- [ ] Criar licença/chave.
- [ ] Editar cada tipo.
- [ ] Excluir item.
- [ ] Restaurar item da lixeira.
- [ ] Excluir definitivamente.
- [ ] Buscar item.
- [ ] Favoritar item.
- [ ] Copiar campos sensíveis.
- [ ] Confirmar limpeza do clipboard após o prazo configurado.

## 3. Senha mestra

- [ ] Trocar senha mestra com senha atual correta.
- [ ] Tentar trocar com senha atual errada.
- [ ] Desbloquear com a nova senha.
- [ ] Confirmar que a senha antiga não abre o cofre.
- [ ] Confirmar que PIN/biometria é atualizado ou desativado corretamente após a troca.

## 4. PIN/biometria do computador

- [ ] Ativar em Segurança.
- [ ] Bloquear cofre.
- [ ] Acessar com PIN.
- [ ] Cancelar prompt do Windows.
- [ ] Confirmar fallback pela senha mestra.
- [ ] Desativar.
- [ ] Confirmar que botão de PIN desaparece no login.
- [ ] Testar em mais de um cofre.

## 5. TOTP

- [ ] Adicionar segredo TOTP.
- [ ] Adicionar URI `otpauth://`.
- [ ] Ver código de 6 dígitos.
- [ ] Confirmar contador regressivo.
- [ ] Copiar código.
- [ ] Fechar e abrir item novamente.

## 6. Anexos

- [ ] Adicionar anexo pequeno.
- [ ] Baixar anexo.
- [ ] Remover anexo.
- [ ] Fechar/desbloquear cofre e confirmar persistência.
- [ ] Testar em mais de um tipo de item.

## 7. Backup e restauração

- [ ] Criar backup manual.
- [ ] Abrir pasta de backups.
- [ ] Verificar backup sem restaurar e confirmar que o cofre atual não muda.
- [ ] Restaurar backup correto.
- [ ] Tentar restaurar com senha errada.
- [ ] Tentar restaurar arquivo inválido.
- [ ] Restaurar backup de outro cofre.
- [ ] Confirmar isolamento entre cofres.

## 8. Multi-cofres

- [ ] Criar cofre novo.
- [ ] Criar item no cofre novo.
- [ ] Trocar para cofre principal.
- [ ] Confirmar que dados não misturam.
- [ ] Trocar para cofre novo novamente.
- [ ] Confirmar PIN/biometria separado por cofre.

## 9. Temas e responsividade

Testar em Escuro, Claro e Misto:

- [ ] Login.
- [ ] Cofre.
- [ ] Analítico.
- [ ] Lixeira.
- [ ] Segurança.
- [ ] Configurações.
- [ ] Popup Adicionar/Editar item.
- [ ] Detalhe do item.
- [ ] Confirmações.

Tamanhos:

- [ ] Maximizado.
- [ ] Médio.
- [ ] Compacto.
- [ ] Altura baixa.
- [ ] Largura baixa.

Regra visual:

- [ ] Container claro tem texto escuro.
- [ ] Container escuro tem texto claro.
- [ ] Botões desativados continuam legíveis.
- [ ] Dropdowns não cortam texto.
- [ ] Scroll aparece quando necessário.

## 10. Bandeja e janela

- [ ] X envia para bandeja.
- [ ] Inatividade envia para bandeja.
- [ ] Clicar/minimizar pela barra de tarefas não envia para bandeja.
- [ ] Clique direito na bandeja mostra:
  - [ ] Abrir APP Completo.
  - [ ] Abrir APP Compacto.
  - [ ] Sair.
- [ ] Abrir APP Completo restaura tamanho desktop.
- [ ] Abrir APP Compacto restaura tamanho compacto.
- [ ] Sair encerra o processo.

## 11. Updater

- [ ] Gerar release.
- [ ] Gerar `SHA256SUMS.txt`.
- [ ] Rodar `npm run release:validate -- -ReleaseDir ".\dist-release\v<versao>"`.
- [ ] Publicar `.exe`, `.exe.sig`, `latest.json` e `SHA256SUMS.txt`.
- [ ] Atualizar pelo app oficial.
- [ ] Confirmar versão exibida.
- [ ] Confirmar que o cofre antigo abre.
