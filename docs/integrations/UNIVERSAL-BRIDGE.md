# Secrets Bridge universal

## Auditoria e evolução proposta

O backend v1.6.0 mantém as chaves em `Zeroizing`, valida o cofre e sua revisão,
autoriza credencial/operação/modelo/contexto no popup e filtra respostas JSON/SSE.
O conector Unix usa `SO_PEERCRED`, hashes de executável/script e diretório observado.
Destinos vêm do cofre ou de uma tabela fixa, com HTTPS, DNS público fixado e sem
redirecionamentos. São reutilizáveis sem criar outro armazenamento de segredos.

Lacunas: transporte Unix exige integração por projeto; permissões têm contagem
manual; não há MCP; o proxy Anthropic cria um servidor por consumidor; o listener
Unix permanece depois da revogação (mas recusa pedidos). O suporte atual à ponte
é Linux. A identidade por hash não isola processos comprometidos da mesma conta.

A menor evolução é um listener Rust em `127.0.0.1:8765`, com `/mcp` e rotas de
inferência, que chama o mesmo executor do broker. O socket privado existente
emite tokens locais temporários; nunca retorna uma chave do provedor. Cada token
é vinculado no primeiro uso ao processo TCP observado e à geração da ponte.
Sessões MCP pertencem a esse token. Tokens diferentes têm permissões separadas.
O nome `clientInfo` não é usado como identidade. No Linux, a conexão TCP inversa
é correlacionada com inode/UID/PID em `/proc`; ambiguidades falham fechadas.

Implementável: MCP Streamable HTTP (JSON, revisão 2025-11-25 e anteriores),
gateway nativo Chat Completions, Responses e Anthropic Messages, seleção por
identificador do provedor ou ID explícito, streaming SSE e limites automáticos.
Não se traduzem protocolos: uma operação precisa existir no provedor escolhido.
MCP não altera o modelo principal do agente. Clientes sem autenticação HTTP
dinâmica podem usar o adaptador stdio genérico fornecido.

Windows continua com o gerenciador/cofre existente; a ponte permanece indisponível
até haver identidade de processo e provisionamento privado equivalentes aos do
Linux. Não é seguro habilitar TCP ali aceitando apenas um nome declarado.

## Limites de segurança

Tokens não substituem o popup. Permissões continuam vinculadas ao contexto,
credencial, operação e modelo e expiram com a ponte. Uma aprovação de sessão
reutiliza esse mesmo escopo; outra sessão MCP, token, operação ou modelo exige
nova aprovação. Encerrar a sessão MCP revoga suas permissões, mesmo que a ponte
continue ativa. A posse de um token roubado
em outro processo é recusada. Um processo comprometido que já tenha acesso ao
processo autorizado, ao depurador ou à conta não é isolado por esta arquitetura.
Um pedido já enviado ao provedor pode consumir recursos após uma revogação;
novos pedidos e eventos de streaming são bloqueados. Limites locais não são um
orçamento monetário; configure limites também no provedor.

Nenhuma configuração externa é alterada pelo KPassword. Instalações de clientes
são ações explícitas, documentadas separadamente. A chave real nunca deve entrar
em `.env`, comandos, configuração MCP ou resultados de ferramentas.

## Configuração inicial dos clientes

O servidor inicia com a sessão da ponte e encerra seu listener HTTP ao parar,
expirar ou trocar/editar o cofre. Porta ocupada causa falha fechada, sem escolher
outra porta nem conectar ao serviço que já está ali.

No Codex com autenticação HTTP dinâmica:

```toml
[mcp_servers.kpassword]
url = "http://127.0.0.1:8765/mcp"
http_headers_helper = "python3 /usr/lib/KPassword/bridge/kpassword_mcp.py --headers"
startup_timeout_sec = 20
tool_timeout_sec = 180
```

Durante desenvolvimento, substitua o caminho pelo caminho absoluto de
`tools/kpassword_mcp.py`. O helper recebe um token pelo socket privado; o Codex
mantém esse token na conexão, sem salvar a chave real. Reinicie/recarregue as
conexões MCP do cliente após configurar. A instalação não modifica o modelo
principal do Codex.

Para clientes sem helper HTTP, configure MCP stdio com comando `python3` e
argumentos `['/usr/lib/KPassword/bridge/kpassword_mcp.py']`. O adaptador conecta ao
mesmo servidor Rust via HTTP e não inicia outro gateway. O RPM inclui o adaptador.

Ferramenta MCP `api_request`:

```json
{
  "provider": "DEEPSEEK_API_KEY",
  "operation": "chat",
  "body": {
    "model": "deepseek-flash",
    "messages": [{"role": "user", "content": "Responda apenas OK."}],
    "max_tokens": 32,
    "thinking": {"type": "disabled"}
  }
}
```

Use `credential_id` se houver múltiplas chaves compatíveis. Não são aceitos chave
real, URL de destino ou identidade declarada. MCP retorna resposta JSON filtrada;
para streaming de inferência, use o gateway.

## Gateway de inferência

Base URL: `http://127.0.0.1:8765/v1`. Rotas POST: `/chat/completions`, `/responses`
e `/messages`, com JSON ou SSE nativos do protocolo correspondente. Não há
conversão automática entre protocolos. DeepSeek suporta os três; outros provedores
podem suportar somente alguns deles. APIs auxiliares como `/models`, Files API e
contagem de tokens não são implementadas.

O consumidor provisiona seu token local pelo helper/socket privado e o envia em
`Authorization: Bearer TOKEN_LOCAL`. Pode indicar o provedor em
`X-KPassword-Provider: DEEPSEEK_API_KEY` e uma credencial específica em
`X-KPassword-Credential: ID`. Modelos `deepseek-*` e `claude-*` selecionam sua
família de provedor; chaves duplicadas continuam exigindo ID explícito. Nos demais
casos, só se escolhe automaticamente quando há uma única chave compatível.

Tokens são vinculados ao PID, início do processo, executável, script/contexto
observados no primeiro uso. Cada cliente/processo precisa provisionar seu próprio
token; não compartilhe um token entre aplicações. Tokens não usados expiram em
120 segundos; tokens vinculados expiram com a ponte e são removidos quando o
processo acaba. Um SDK que suporta somente chaves persistidas precisa de um
lançador que provisione o token local (não a chave real). Isso é configuração
inicial do cliente, não uma integração por projeto.

Limites automáticos: 4 chamadas em andamento no núcleo, 60 chamadas/minuto por
credencial e por token HTTP, 8.192 tokens de saída/chamada, reservas de até 131.072
tokens de saída/hora por token HTTP e 524.288/hora por credencial. Reservas usam o
limite solicitado (ou 8.192 por padrão), inclusive em erros, e não medem cobrança
real. Ao atingir um limite, retorna `quota_exceeded`; renovar uma permissão não
substitui o limite central. Ajustar `max_tokens` é o controle normal de geração,
não uma quantidade de chamadas a autorizar no popup.

Host/Origin de outros destinos são recusados, não há CORS amplo, encaminhamento
de headers de autenticação do consumidor ou acesso remoto. Cabeçalhos duplicados,
Transfer-Encoding e pedidos acima do limite são recusados. Clientes devem enviar
Content-Length; entrada HTTP chunked não é suportada nesta implementação.

Referências: [MCP Streamable HTTP 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[configuração MCP do Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[DeepSeek v4.1 Flash](https://api-docs.deepseek.com/news/news260910/).

## Validação local

`cargo test --offline --lib --manifest-path src-tauri/Cargo.toml` verifica o núcleo,
os formatos de cofre, identidade Unix/TCP, isolamento de tokens/sessões, seleção
ambígua, limites, Host/Origin e framing. Testes de sockets precisam de acesso aos
sockets e ao `/proc` do ambiente local; sandboxes restritivos podem bloqueá-los.
`python3 tools/kpassword_mcp.test.py` verifica o adaptador genérico.

Com o Bridge ativo, `python3 tools/kpassword_universal_integration.py` verifica o
servidor real sem chamar o provedor. Acrescentar `--real` executa chamadas cobradas
somente com `deepseek-flash`, via MCP e gateway (JSON/SSE, três protocolos e
concorrência). As aprovações continuam no popup do KPassword. O programa imprime
somente resultados de verificação, códigos HTTP, modelo e contagem de eventos.
Nunca registra tokens, headers, corpos ou chaves reais.

Para executar a interface incorporada a partir do código-fonte:

```bash
npm run build
cargo build --offline --release --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml
./src-tauri/target/release/kpassword
```

A feature `tauri/custom-protocol` é necessária na compilação direta para carregar
os assets incorporados. A compilação via `tauri build` já configura o empacotamento.

## Resultados verificados em 13/10/2026

No Linux local, passaram 91 testes Rust, 140 testes de frontend, 4 do adaptador
MCP, 8 do cliente Unix e 6 do proxy legado. A compilação de frontend e o binário
release com assets incorporados também passaram.

Com o cofre desbloqueado pelo usuário e o Bridge ativo, o servidor real passou
inicialização/descoberta MCP, isolamento entre tokens/sessões e rejeição de versão
inválida, token inválido, Origin indevido e token roubado por outro processo.
O cliente HTTP nativo do Codex descobriu `api_request` e realizou duas chamadas
reais. Outras 11 chamadas reais verificaram MCP em duas sessões, gateway Chat,
Responses e Messages em JSON e SSE, além de duas chamadas concorrentes. Todas
usaram exclusivamente `deepseek-flash` e retornaram HTTP 200; não houve fallback.
Os testes foram feitos com limites de saída de 64 tokens por chamada. Após o
usuário encerrar o Bridge, o listener fechado e a recusa do token anterior foram
confirmados no servidor real.

A configuração MCP foi instalada no Codex do usuário com helper dinâmico apontando
para o checkout local. O teste nativo usou contexto efêmero, sem turno de geração
nem troca do modelo principal do Codex. Nenhuma chave de provedor foi copiada para
a configuração. Windows não foi executado neste ambiente. A expiração foi
verificada por testes de estado; não se aguardou o prazo real de 48 horas.
