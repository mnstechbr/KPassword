# KPassword — conector de chamadas de API

O Bridge faz a chamada HTTPS e retorna somente a resposta. Não entrega a chave
para Claude, Codex, o projeto ou o conector. Não procure credenciais em arquivos,
no histórico, no clipboard ou no cofre e não peça que o usuário cole uma chave.

No Fedora, o usuário cadastra uma API Key, desbloqueia o cofre, permite Secrets
Bridge e ativa a sessão. A aplicação precisa ser adaptada para chamar o conector
`tools/kpassword_bridge_client.py`; dizer “use KPassword” não configura um SDK.
O ID exibido nos detalhes da chave é uma referência pública, não uma credencial.

Exemplo Python, dentro do processo da aplicação:

```python
from kpassword_bridge_client import request_api
response = request_api(KEY_RECORD_ID, "responses", {
    "model": MODEL_NAME,
    "input": "Uma pergunta sem credenciais",
    "stream": False,
})
```

O KPassword abre uma janela própria de aprovação na área de trabalho, inclusive
com o cofre bloqueado na bandeja. Ela mostra a credencial, provedor, operação,
modelo, executável, script identificável, diretório e fingerprint de identidade.
Aprovar permite uma chamada; recusar, fechar ou ignorar 30 segundos impede a chamada.
“Continuar permitindo” inclui esses elementos na sessão da ponte, com limite de
chamadas escolhido no popup (padrão 10.000, máximo 100.000). Cada permissão aceita
até 60 chamadas por minuto; geração tem teto de 8.192 tokens de saída. Esses limites
não são orçamento monetário. Configure limites no provedor também.

O usuário escolhe 24, 48 ou 72 horas para a ponte, padrão 48, ou até sair/reiniciar.
Trocar de tarefa no mesmo contexto preserva a permissão. O bloqueio automático ou
X não encerram a ponte. Encerrar o Bridge, bloquear manualmente, salvar/editar ou
trocar o cofre invalida novos pedidos. Não há credenciais ou permissões persistidas
fora do cofre para reativação automática. Uma chamada autorizada em andamento pode
terminar após revogação. O provedor recebe o conteúdo e chamadas podem gerar cobrança.

Operações e identificadores suportados:

| Identificador no cofre | Operações | Destino fixo |
| --- | --- | --- |
| OPENAI_API_KEY | responses, chat, embeddings | https://api.openai.com/v1/ |
| DEEPSEEK_API_KEY | chat | https://api.deepseek.com/ |
| ANTHROPIC_API_KEY | messages | https://api.anthropic.com/v1/ |

O protocolo não aceita URL, cabeçalhos ou identidade declarada pelo cliente.
Redirecionamentos e proxies de ambiente são desativados. Pedido limitado a 1 MiB;
resposta JSON limitada a 4 MiB; streaming ainda indisponível. O transporte é um
socket Unix em diretório privado (0700), socket 0600, acessível pela mesma conta.
Não há servidor TCP, porta pública nem exportação de chaves ao consumidor.
O inicializador antigo `--bridge-request` não entrega mais chaves.

**Limites de identidade:** SO_PEERCRED e /proc fornecem processo, executável,
script de entrada quando identificável e diretório. O conector CLI tenta identificar
o script do lançador em uma cadeia limitada; preferimos integrar request_api no
processo do projeto. Mudança de script/hash, diretório, modelo ou operação pede
nova aprovação. A identificação de script suporta Python, Node, Bun e Deno. Interpretadores
reconhecidos sem script identificável, incluindo Ruby/Perl/PHP/shell/Java/.NET,
aceitam apenas aprovação única; runtimes desconhecidos não têm garantia de
identificação de script. Nome declarado pelo cliente não é uma identidade confiável.

Isso não é um sandbox contra malware da mesma conta, root, depuração/injeção,
captura de teclado ou furto da senha mestra. Outro processo comprometido dessa
conta pode manipular o contexto; não trate diretório/script como identidade forte
contra esse atacante. Copiar o arquivo criptografado não gera popup. Com a ponte
ativa, as chaves de API ficam na memória do backend. O cofre preserva os formatos
originais. O Bridge aceita chamadas com API Keys, não senhas comuns, e clientes
locais no Fedora; Windows preserva funções originais, sem este conector ainda.

**Produção/VPS/Vercel:** utilize credencial própria de produção no gerenciador de
segredos do serviço. Na Vercel, use variável Secret no backend; nunca variáveis
públicas ou código enviado ao navegador. Na VPS, limite o acesso ao serviço que
precisa do segredo. O socket local não é acessível remotamente e não deve ser
exposto. A máquina local não precisa ficar ligada para a produção funcionar.
Aplicações/SDKs sem adaptador não são conectados automaticamente.
