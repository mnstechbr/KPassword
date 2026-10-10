# KPassword Secrets Bridge — instruções para Claude Code

Esta integração funciona no Fedora e exige configuração explícita pelo usuário.
Não procure chaves em arquivos, no histórico do terminal, no clipboard ou no cofre.
Não solicite que o usuário cole uma chave no chat, nem use comandos para imprimir
variáveis de ambiente, memória de processos ou arquivos de autenticação.

O usuário deve cadastrar uma chave de API no KPassword, permitir o executável
Claude Code nessa chave, desbloquear o cofre e ativar a sessão do Bridge.
O detalhe da chave mostra um comando sem segredos:

```
kpassword --bridge-request ID_DA_CHAVE ID_DA_INTEGRACAO
```

Use apenas os IDs informados pelo usuário. Este comando solicita que o KPassword
mostre um popup de confirmação e inicie **uma nova execução** do programa salvo
na autorização. Não retorna a chave ao solicitante, não autentica o solicitante
pelo nome e não dá acesso retroativo a este processo Claude Code.
O programa lançado recebe somente a chave aprovada. Rejeitar o popup, bloquear
o cofre, expirar a sessão ou mudar o executável impede uma nova entrega.

Para carregar estas instruções no Claude Code, o usuário pode colocá-las no
`CLAUDE.md` do seu projeto. Mencionar “use KPassword” sem essas instruções e
sem o cadastro da integração não configura automaticamente a autenticação.

O programa autorizado e seus subprocessos podem ler a chave recebida. Bloquear
o cofre não revoga a chave no provedor e não remove cópias feitas pelo consumidor.
Esta integração não constitui um sandbox contra outros programas da mesma conta.
