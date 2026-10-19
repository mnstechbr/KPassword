# KPassword — conector de chamadas de API

O Bridge faz a chamada HTTPS e retorna somente a resposta. Não entrega a chave
para Claude, Codex, o projeto ou o conector. Não procure credenciais em arquivos,
no histórico, no clipboard ou no cofre e não peça que o usuário cole uma chave.

No Fedora, o usuário cadastra uma API Key, desbloqueia o cofre, permite Secrets
Bridge e ativa a sessão. Clientes MCP podem usar o servidor HTTP universal ou o adaptador stdio
`tools/kpassword_mcp.py`, sem integração por projeto. O conector Unix
`tools/kpassword_bridge_client.py` continua compatível. Veja [MCP e gateway](UNIVERSAL-BRIDGE.md).
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
“Continuar permitindo” inclui esses elementos na sessão da ponte, sem exigir
quantidade de chamadas. Reconectar ou reiniciar o mesmo aplicativo/projeto não
exige nova aprovação durante a ponte. Não há cota local de chamadas ou tokens por
padrão. Cotas opcionais são controladas em Segurança → Integrações, por aplicativo
e credencial, com `0` para ilimitado. O máximo de geração solicitado segue para o
provedor sem o antigo teto local de 8.192 tokens; veja contabilização, defaults e
metadados de retomada no [guia universal](UNIVERSAL-BRIDGE.md). Os limites e a
cobrança do provedor continuam valendo.

O usuário escolhe 24, 48 ou 72 horas para a ponte, padrão 48, ou até sair/reiniciar.
Trocar de tarefa no mesmo contexto preserva a permissão. O bloqueio automático ou
X não encerram a ponte. Histórico e backup sem alteração de conteúdo também preservam a sessão. O tempo restante aparece somente nas configurações de Segurança. Encerrar o Bridge, bloquear manualmente, editar ou
trocar o cofre invalida novos pedidos. Não há credenciais ou permissões persistidas
fora do cofre para reativação automática. Uma chamada autorizada em andamento pode
terminar após revogação. O provedor recebe o conteúdo e chamadas podem gerar cobrança.

Operações e identificadores suportados:

| Identificador no cofre | Operações | Destino fixo |
| --- | --- | --- |
| OPENAI_API_KEY | responses, chat, embeddings | https://api.openai.com/v1/ |
| DEEPSEEK_API_KEY | chat, messages, responses | https://api.deepseek.com/ (Messages em /anthropic/v1/messages) |
| ANTHROPIC_API_KEY | messages | https://api.anthropic.com/v1/ |
| ZAI_API_KEY / Z_AI_API_KEY | chat | https://api.z.ai/api/paas/v4/ |
| MIMO_API_KEY / XIAOMI_API_KEY | chat | https://api.xiaomimimo.com/v1/ |

O protocolo não aceita URL, cabeçalhos ou identidade declarada pelo cliente.
Redirecionamentos e proxies de ambiente são desativados. Pedido limitado a 1 MiB;
resposta JSON/evento limitado a 4 MiB; stream limitado a 128 MiB e 120 segundos no provedor. O transporte é um
socket Unix em diretório privado (0700), socket 0600, acessível pela mesma conta.
O broker abre um único servidor TCP autenticado em 127.0.0.1:8765 enquanto a ponte está ativa. O adaptador Anthropic antigo continua disponível por compatibilidade; prefira o gateway universal. Nenhum deles exporta a chave do provedor.
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

## Streaming e Claude Code

```python
from kpassword_bridge_client import stream_api
for event in stream_api(KEY_RECORD_ID, "messages", {
    "model": "deepseek-flash", "max_tokens": 4096,
    "messages": [{"role": "user", "content": "Uma pergunta sem credenciais"}],
}):
    # event contém o nome do evento SSE e seu JSON; inclui deltas de ferramentas.
    process_event(event)
```

O RPM inclui ambos os programas em `/usr/lib/KPassword/bridge`. Exemplo de novo
lançador, executado no diretório do projeto:

```bash
python3 /usr/lib/KPassword/bridge/kpassword_claude_proxy.py --key-id ID_DA_CREDENCIAL --model deepseek-flash -- claude
```

Substitua o lançador antigo que procurava `DEEPSEEK_API_KEY` pelo comando acima;
não passe chave real por argumento ou ambiente. O adaptador inicia a aplicação
com URL loopback e um token aleatório daquela execução, válido somente no proxy.
O token não permite chamadas diretas ao provedor e não é persistido pelo adaptador.
A configuração antiga de um SDK pode sobrescrever variáveis de ambiente: remova
essa configuração de chave/URL para usar o novo fluxo. O adaptador fixa o modelo
selecionado, inclusive para aliases pequenos/grandes do cliente. A permissão mostra
a identidade real do adaptador e o diretório do projeto; não afirma identificar
cada subprocesso HTTP como Claude. Apps com esse token compartilham o mesmo adaptador.
Reiniciar o adaptador muda o token local, mas sua identidade/script/projeto continuam
sujeitos à mesma permissão vigente do KPassword. Mudar o modelo pede autorização.

DeepSeek oferece [Messages no formato Anthropic, streaming e ferramentas](https://api-docs.deepseek.com/zh-cn/guides/anthropic_api/).
Usamos essa interface, sem converter parcialmente Chat Completions. O proxy oferece
somente POST `/v1/messages`; endpoints de contagem de tokens, arquivos, batch e
outras APIs retornam 501. Requisições sem token, com Host diferente ou Origin de
navegador são recusadas. O tráfego adicional do cliente é desabilitado pelo lançador.
Ele não controla extensões/configurações internas do cliente nem isola malware da
mesma conta capaz de ler/injetar memória. O cliente continua responsável pelas
permissões para executar ferramentas no projeto.

## Outros provedores e serviços

No item Chave de API, escolha formato e URL oficial **sem credenciais na URL**:

| Formato | URL cadastrada | Operações |
| --- | --- | --- |
| OpenAI compatível | URL base, por exemplo `https://api.example.com/v1` | chat, responses, embeddings |
| Anthropic compatível | URL base terminando em `/v1` | messages |
| HTTPS JSON | URL completa de um endpoint | http.get, http.post |

Autenticação: `Authorization: Bearer`, `x-api-key`, `x-goog-api-key` ou `api-key`.
O corpo em `http.post` é o JSON enviado; em `http.get`, pares escalares são
codificados como parâmetros. URL, método permitido e autenticação são fixados no
cofre. O consumidor não pode escolher headers, trocar origem ou usar URL arbitrária.
DNS é validado e os endereços públicos são fixados para aquela conexão, bloqueando
rede privada, localhost, ranges especiais, redirecionamento e proxy de ambiente.
Para múltiplos endpoints JSON, cadastre configurações separadas com os escopos
necessários. Não cadastre senhas em URLs ou parâmetros.

Z.AI e MiMo têm perfis padrão de Chat; planos de coding/endpoints alternativos
exigem a URL oficial correspondente configurada pelo usuário. Veja [Z.AI](https://docs.z.ai/guides/capabilities/mcp-call)
e [MiMo](https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content).
JEV, TypeScript ou qualquer outro nome não são interpretados como protocolos:
confira a documentação do serviço e escolha seu formato. Serviços com OAuth,
respostas binárias, assinatura proprietária ou outra autenticação exigem uma
operação/adaptador adicional. O suporte é ao protocolo, não uma promessa de que
todas as funções de todo SDK estejam disponíveis automaticamente.

## Telegram

Identificador `TELEGRAM_BOT_TOKEN` (alias `TELEGRAM_TOKEN`):

- `telegram.get_me`: `{}`.
- `telegram.send_message`: `{"chat_id":"123456", "text":"Mensagem"}`; aceita
  também parse_mode, disable_notification, protect_content e message_thread_id.
  A permissão contínua é específica ao destinatário; use ID numérico.
- `telegram.get_updates`: offset, limit (1–100), timeout (0–50) e allowed_updates.

Somente métodos explícitos de [Bot API](https://core.telegram.org/bots/api), com
destino fixo, JSON e sem devolver o token. Não inclui upload/download de arquivos.

## Mercado Pago

`MERCADO_PAGO_ACCESS_TOKEN` (alias `MERCADOPAGO_ACCESS_TOKEN`):

- `mercadopago.get_payment`: `{"id":"ID"}`.
- `mercadopago.create_payment`: `{"idempotency_key":"ID_UNICO_COM_16_OU_MAIS_CARACTERES", "payment":{...}}`.
- `mercadopago.create_preference`: `{"body":{...}}`.
- `mercadopago.get_preapproval`: `{"id":"ID"}`.
- `mercadopago.create_preapproval`: `{"body":{...}}`.
- `mercadopago.update_preapproval`: `{"id":"ID", "body":{...}}`.

Corpos seguem o contrato do provedor. Consulta/alteração tem permissão por recurso;
criação tem permissão por operação, com limites automáticos de frequência. Pagamentos autorizados
podem movimentar dinheiro: o aplicativo deve controlar consentimento de compra,
idempotência, valores e ambiente de teste/produção. O Bridge não substitui isso.

Cadastre **outro item** `MERCADO_PAGO_WEBHOOK_SECRET` para
`mercadopago.verify_webhook`:

```python
check = request_api(WEBHOOK_SECRET_RECORD_ID, "mercadopago.verify_webhook", {
    "data_id": ID_RECEBIDO_NA_QUERY, "x_request_id": HEADER_REQUEST_ID,
    "x_signature": HEADER_SIGNATURE,
})
if not check["valid"]:
    reject_notification()
```

Retorna somente `{"valid": true/false}`, nunca segredo ou digest calculado.
Confere [manifesto HMAC-SHA256 do Mercado Pago](https://www.mercadopago.com.br/developers/es/docs/wallet-connect/notifications),
normaliza o ID para minúsculas e compara em tempo constante. Exige ID/request-id,
recusa campos duplicados/assinatura malformada e timestamp com mais de cinco
minutos ou mais de 30 segundos no futuro. Aceita timestamp em segundos ou
milissegundos. Essa janela pode recusar reenvios antigos legítimos: reconcilie
consultando o recurso no provedor. A assinatura cobre ID/request-id/timestamp,
não todo o corpo; busque o estado do pagamento na API antes de efetivar ações.
Controle eventos já processados no aplicativo para impedir replay dentro da janela.
Essa operação é **local**; servidor publicado guarda seu segredo de produção no
ambiente de produção, sem depender do desktop.

## Diagnósticos

`BridgeDenied.code` identifica a falha sem expor conteúdo de exceções/provedor:
bridge_inactive, session_expired, key_not_found, user_denied, approval_expired,
permission_revoked, quota_exceeded, bridge_busy, unsupported_operation,
invalid_request, provider_unavailable, identity_changed, vault_changed,
destination_blocked, bridge_timeout e request_failed. HTTP não-2xx do provedor usa
provider_http_error com `status`, sem imprimir o corpo. O CLI exibe o código em
stderr e retorna 1; sucesso retorna somente JSON/eventos em stdout.
