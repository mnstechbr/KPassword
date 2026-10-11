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

O KPassword mostra chave, provedor, operação, PID, executável e SHA-256.
Aprovar permite uma chamada; recusar ou deixar passar 30 segundos impede a chamada.
“Continuar permitindo” vale somente para aquela chave, executável/hash e operação
na sessão atual. Encerrar o Bridge, bloquear, salvar ou trocar o cofre invalida
novos pedidos. Uma chamada já enviada ao provedor não pode ser desfeita.
O provedor recebe o conteúdo da solicitação e chamadas podem gerar cobrança.

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

**Limites:** SO_PEERCRED identifica o processo, não garante a identidade de um
projeto executado por Python/Node, plugins ou subprocessos. Autorizar continuamente
um interpretador pode permitir outros scripts daquele mesmo interpretador.
Não é um sandbox contra malware da mesma conta, root, depuração/injeção de processo,
captura de teclado ou furto da senha mestra. Copiar o arquivo criptografado não gera
popup. A criptografia protege o conteúdo enquanto a chave de decriptação não for
comprometida. O Bridge nesta fase aceita apenas chamadas com API Keys, não senhas
convencionais, e apenas clientes locais no Fedora. Windows mantém o cofre e as
funções originais; não oferece este conector ainda.

**VPS:** o socket local não é acessível remotamente. Não exponha o socket, o cofre
ou uma API de entrega de credenciais. Usar esta arquitetura remotamente exige um
serviço autenticado com autorização, limites e revogação próprios. Dependendo do
serviço escolhido, seu computador precisaria ficar ligado ou a chave ficaria em
um gerenciador de segredos no servidor. Essa integração não foi implementada.
Aplicações/SDKs sem adaptador não são conectados automaticamente.
