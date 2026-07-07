# Guia rápido do KPassword

## O que o KPassword resolve?

O KPassword ajuda a:

1. Guardar senhas de sites, sistemas e contas pessoais.
2. Salvar notas seguras, cartões, identidades e licenças.
3. Identificar senhas fracas, repetidas, antigas ou vencidas.
4. Manter backups criptografados sem depender de nuvem.
5. Usar TOTP/2FA junto das credenciais quando fizer sentido.
6. Separar cofres por contexto, como pessoal, trabalho ou projetos.

## Primeiro uso

1. Crie uma senha mestra.
2. Guarde essa senha em local seguro.
3. Crie os primeiros itens no Cofre.
4. Configure backup e validade de senha em Segurança.
5. Ative PIN/biometria do computador se quiser desbloqueio rápido.

## Cofre

A tela Cofre é onde ficam seus itens sensíveis:

- Credenciais.
- Notas seguras.
- Cartões.
- Identidades.
- Licenças/chaves.

## Assistente do Cofre

A tela Assistente do Cofre mostra a saúde do cofre e transforma alertas em ações diretas:

- Total de itens.
- Itens que precisam de atenção.
- Senhas fracas, repetidas, antigas ou vencidas.
- Proteções locais ativas.

## Segurança

A tela Segurança concentra:

- Senha mestra.
- PIN/biometria do computador.
- Backups.
- Importação/restauração.
- Exportação.
- Pastas locais.

## Configurações

A tela Configurações concentra preferências de interface:

- Tema.
- Idioma.
- Densidade.
- Movimento reduzido.
- Ajuda e sobre.

## Importante

O KPassword não consegue recuperar sua senha mestra. Isso é parte do modelo de segurança.

## Diagnóstico do Cofre

Na tela **Assistente do Cofre**, o KPassword mostra a saúde geral do cofre, uma próxima ação recomendada e uma fila curta de itens para revisar.

Você pode abrir o site, ver a credencial, adicionar 2FA, filtrar problemas ou aplicar sugestões de organização com confirmação.

Ao abrir uma credencial, o detalhe também mostra o diagnóstico individual daquele item.


## 2FA/TOTP prático

Ao adicionar 2FA em uma credencial, prefira importar um print/imagem com QR Code ou selecionar o QR Code exibido na tela. O KPassword lê o QR localmente e mostra uma prévia antes de salvar.

O modo manual avançado continua disponível para colar `otpauth://` ou chave secreta quando a leitura por QR não for possível.

Guardar 2FA no KPassword facilita o uso, mas mantém senha e código no mesmo cofre. Para maior separação entre fatores, use um autenticador separado.

## Correções v1.1.1

- A importação CSV entende URLs `otpauth://` nas colunas de TOTP e salva apenas o segredo compatível.
- Notas multilinha entre aspas no CSV são preservadas durante a importação.
- Imagens muito grandes de QR Code são recusadas antes do processamento.
- A captura completa usada na seleção de QR é descartada após a leitura bem-sucedida do recorte.
- Windows Hello/PIN/biometria é desbloqueio rápido local, não substituto da senha mestra nem segundo fator separado.
