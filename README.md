# KPassword

Gerenciador local de senhas e chaves de API para **Windows e Fedora Linux**, com cofre criptografado e interface compartilhada em Tauri, React e Rust.

As senhas e backups ficam no seu computador. Não é necessária conta nem nuvem para usar o cofre. O **Secrets Bridge**, opcional no Fedora, permite chamadas de API autorizadas: o KPassword usa a chave internamente e devolve somente a resposta ao programa. Essas chamadas enviam o conteúdo solicitado ao provedor e podem gerar cobrança.

## Download e instalação — v1.7.1

[Baixar a versão mais recente](https://github.com/mnstechbr/KPassword/releases/latest) · [Novidades da 1.7.1](docs/releases/v1.7.1.md)

| Plataforma | Instalador | Atualizações |
| --- | --- | --- |
| Windows x64 | `KPassword-Setup-v1.7.1.exe` | Atualizador com assinatura, após a instalação manual da 1.5.0 ou mais recente |
| Fedora 44 x86_64 | `KPassword-1.7.1-1.x86_64.rpm` | O app abre a Release; instalação/atualização pelo DNF |

No Windows, execute o `.exe`. A chave pública de atualização foi renovada na 1.5.0: versões anteriores precisam de uma atualização manual, sem apagar cofres ou dados.

No Fedora, baixe o RPM e execute na pasta do download:

```bash
sudo dnf install ./KPassword-1.7.1-1.x86_64.rpm
```

Abra o KPassword, crie ou desbloqueie seu cofre e guarde a senha mestra: ela não pode ser recuperada pelo projeto. Faça backups criptografados antes de atualizar. Cofres legados PBKDF2 e atuais Argon2id/AES-GCM continuam compatíveis entre plataformas.

## Recursos do cofre

- Credenciais, **chaves de API**, notas seguras, cartões, identidades e licenças.
- TOTP/2FA e leitura local de QR Code; Fedora utiliza o portal do desktop para captura.
- Gerador de senhas, avaliação de força, assistente e diagnóstico de senhas reutilizadas, antigas, fracas ou sem 2FA.
- Tags, busca, filtros, anexos e histórico de ações sem valores sensíveis.
- Backups criptografados `.kpvault`, verificação e restauração.
- Importação CSV com prévia e exportação CSV com aviso: CSV não é criptografado.
- Exclusão de cofre com senha mestra, confirmação e cópia criptografada de recuperação.
- Temas escuro, claro e sistema, seleção de idioma e bandeja do sistema.
- Windows Hello/PIN/biometria opcional no Windows; senha mestra no Fedora.
- Clipboard, notificações e inicialização automática com configurações próprias por plataforma.
- Adaptação gráfica para Fedora com NVIDIA/Wayland, preservando a versão Windows.

## Secrets Bridge: usar APIs sem entregar a chave

Disponível **localmente no Fedora**. O Bridge não exporta a chave para `.env`, argumentos, clipboard ou para o aplicativo consumidor. Um único servidor local oferece MCP e gateway de inferência. Após configurar o cliente uma vez, não é necessário adaptar cada projeto. Dizer “minha chave está no KPassword” não configura automaticamente o cliente.

1. Cadastre um item **Chave de API** com o identificador do provedor.
2. Em **Segurança → Integrações e permissões**, habilite Secrets Bridge, escolha 24, 48 ou 72 horas e ative a sessão com o cofre desbloqueado. O padrão é 48 horas.
3. Configure o cliente MCP para `http://127.0.0.1:8765/mcp`, com token local dinâmico, ou use o adaptador stdio genérico. Veja o [guia universal](docs/integrations/UNIVERSAL-BRIDGE.md).
4. Solicite a API pelo identificador do provedor (por exemplo, `DEEPSEEK_API_KEY`). Se houver várias chaves compatíveis, informe o ID da credencial. Aparece uma **janela própria de aprovação na área de trabalho**, mesmo com o cofre bloqueado na bandeja.
5. Escolha **Aprovar uma vez**, **Recusar** ou **Continuar permitindo**. Fechar o popup ou ignorá-lo por 30 segundos recusa o pedido.

A permissão contínua inclui identidade observada do executável/script, diretório de trabalho, credencial, operação e modelo. **Trocar de tarefa no mesmo contexto não exige nova aprovação.** Mudanças nesses elementos, outro token ou uma nova sessão MCP exigem outro pedido. A identificação de script suporta Python, Node, Bun e Deno. Interpretadores reconhecidos sem script identificável, incluindo Ruby/Perl/PHP/shell/Java/.NET, aceitam apenas aprovação única; runtimes desconhecidos não têm garantia de identificação de script.

**O bloqueio automático da interface e o X não encerram a ponte.** A sessão termina quando expira, o KPassword é encerrado, o computador reinicia, o cofre é editado/trocado ou o usuário bloqueia manualmente/revoga o acesso. Use o ícone da bandeja para **Revogar todos os acessos da ponte**, ou consulte/revogue permissões individuais em Segurança → Integrações e permissões. As autorizações não ficam salvas em disco; reiniciar exige desbloquear e reativar a ponte.

Não é preciso escolher uma quantidade de chamadas: “continuar permitindo” autoriza o mesmo aplicativo/projeto, credencial, operação e modelo até encerrar a ponte, inclusive após reconexões. Não há cotas locais de chamadas ou tokens por padrão. Em Segurança → Integrações, você pode configurar cotas opcionais por aplicativo e credencial (`0` = ilimitado). Reservas de saída são reconciliadas com o uso informado pelo provedor; erros de cota incluem saldo e prazo de retomada. O núcleo mantém 4 chamadas simultâneas e a proteção das credenciais. Limites e cobrança do provedor continuam valendo. Um pedido já enviado pode terminar após revogação. Histórico/backup sem mudança de conteúdo preservam a ponte. Veja os detalhes no guia universal.

### Configurar MCP no Codex

No Fedora com o RPM instalado, adicione à configuração MCP do Codex
(`~/.codex/config.toml`):

```toml
[mcp_servers.kpassword]
url = "http://127.0.0.1:8765/mcp"
http_headers_helper = "python3 /usr/lib/KPassword/bridge/kpassword_mcp.py --headers"
startup_timeout_sec = 20
tool_timeout_sec = 180
enabled_tools = ["api_request"]
```

O helper provisiona um token local temporário pelo socket privado. **Não coloque
a chave real do provedor nessa configuração.** Reinicie ou recarregue as conexões
MCP do Codex após configurar e mantenha a sessão do Bridge ativa no KPassword.
Essa configuração é feita uma vez por cliente, sem criar uma conexão por projeto.

Para clientes que não suportam o helper HTTP, configure MCP stdio com comando
`python3` e argumento `/usr/lib/KPassword/bridge/kpassword_mcp.py`. Esse adaptador
usa o mesmo servidor Rust; não inicia outro gateway. No código-fonte, substitua
o caminho pelo caminho absoluto de `tools/kpassword_mcp.py`.

### Usar a ferramenta MCP

Peça ao agente para chamar `api_request` com o identificador da chave cadastrada.
Por exemplo, os argumentos para DeepSeek v4.1 Flash são:

```json
{
  "provider": "DEEPSEEK_API_KEY",
  "operation": "chat",
  "body": {
    "model": "deepseek-flash",
    "messages": [{"role": "user", "content": "Responda apenas OK."}],
    "max_tokens": 64,
    "thinking": {"type": "disabled"}
  }
}
```

O KPassword resolve a credencial internamente e apresenta a autorização. Se houver
mais de uma chave compatível, acrescente `credential_id` com o ID da credencial.
A resposta contém o resultado da API, sem a chave secreta. Aprovar a sessão
reutiliza a permissão para a mesma sessão, credencial, operação e modelo.

| Identificador da chave no cofre | Operações |
| --- | --- |
| `OPENAI_API_KEY` | `responses`, `chat`, `embeddings` |
| `DEEPSEEK_API_KEY` | `chat`, `messages`, `responses` |
| `ANTHROPIC_API_KEY` | `messages` |
| `ZAI_API_KEY` / `Z_AI_API_KEY` | `chat` |
| `MIMO_API_KEY` / `XIAOMI_API_KEY` | `chat` |
| `TELEGRAM_BOT_TOKEN` | `telegram.get_me`, `telegram.send_message`, `telegram.get_updates` |
| `MERCADO_PAGO_ACCESS_TOKEN` | operações de pagamento, preferência e assinatura |
| `MERCADO_PAGO_WEBHOOK_SECRET` | `mercadopago.verify_webhook` (resultado da verificação, sem entregar o segredo) |

### Gateway de inferência e compatibilidade

MCP fornece ferramentas de API; **não troca o modelo principal do agente**.
Para clientes compatíveis que desejam usar o provedor como modelo principal,
o gateway tem base URL `http://127.0.0.1:8765/v1` e rotas `/chat/completions`,
`/responses` e `/messages`, com JSON ou SSE nativos do provedor. O cliente precisa
provisionar seu próprio token local temporário; não compartilhe tokens entre
processos e não use a chave real como autenticação do gateway.

Veja o [guia universal de MCP e gateway](docs/integrations/UNIVERSAL-BRIDGE.md)
para provisionamento, escopos de sessão e integração dos clientes. O conector Unix
`kpassword_bridge_client.py` e o proxy `kpassword_claude_proxy.py` continuam
disponíveis por compatibilidade, com exemplos no [guia dos conectores legados](docs/integrations/CLAUDE.md).

**Outros provedores:** no item Chave de API, selecione o formato (OpenAI, Anthropic ou JSON) e a URL HTTPS oficial. Isso atende outros serviços compatíveis sem cadastrar cada marca no código. O destino é configuração autenticada do cofre; mudar essa configuração revoga a sessão. Nomes de serviço sozinhos não definem seu protocolo.

**Limites atuais:** pedidos até 1 MiB, respostas JSON/eventos até 4 MiB e stream até 128 MiB/120 segundos de conexão com o provedor. O gateway atende os três protocolos quando o provedor é compatível; não traduz protocolos nem oferece `/models`, Files API, contagem de tokens ou entrada HTTP chunked. Não há integração automática de todos os SDKs, respostas binárias, OAuth interativo, suporte a senhas comuns pelo Bridge, cliente Windows do Bridge ou acesso remoto.

## Segurança e privacidade

O cofre é criptografado em repouso. Com a ponte ativa, as chaves de API permanecem disponíveis na memória do backend, mesmo com a interface bloqueada; as demais credenciais e a senha mestra são removidas da interface ao bloquear. O usuário deve revogar a ponte quando não quiser mais autorizar chamadas.

O socket Unix fica em diretório privado (0700), com permissão 0600. O servidor MCP/gateway abre somente loopback enquanto a ponte está ativa, com tokens temporários e validação de Host/Origin. A identidade é obtida do processo pelo sistema, incluindo executável, script quando identificável e diretório; o pedido não pode simplesmente declarar “sou Claude”. Isso **não é isolamento contra malware da mesma conta, root, injeção/depuração ou captura de teclado**. Copiar o arquivo criptografado não gera popup. A ponte controla pedidos feitos pelo MCP, gateway e conectores compatíveis.

Os destinos HTTPS são fixos pelos perfis de provedor ou pela configuração autenticada do cofre, sem redirecionamentos ou proxies do ambiente. Histórico não contém chaves nem conteúdo de pedidos/respostas. Autorizar uma aplicação também autoriza o envio de seus dados ao provedor e o consumo de sua cota.

Windows Hello é uma conveniência protegida pelo contexto Windows/DPAPI, não um segundo fator independente. Guardar TOTP e senha no mesmo cofre reduz a separação entre fatores. Use `.kpvault` para backup; exportações CSV exigem cuidado próprio.

### Produção: Vercel ou VPS

O Bridge é para desenvolvimento e uso **local**. Uma aplicação publicada utiliza uma credencial própria de produção, diferente da local, guardada no gerenciador de segredos do ambiente. Na Vercel, use variável do tipo **Secret**, acessível somente no backend; nunca coloque uma API key em variáveis públicas ou no código do navegador. Na VPS, limite o acesso ao segredo ao serviço que realmente precisa dele. Não exponha o cofre ou o socket do KPassword pela internet.

## Build e publicação

```bash
npm ci
npm run version:check
npm test
npm run build
```

Windows: mantenha as dependências nativas Windows e gere o instalador NSIS. Fedora: consulte [dependências e build nativo](docs/FEDORA_NATIVE.md) e execute:

```bash
cargo test --locked --lib --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --ci --bundles rpm -- --locked
```

O GitHub Actions verifica Windows e Fedora separadamente, incluindo vetores independentes de compatibilidade de cofres. Os instaladores são assinados **localmente** após os checks: a chave privada criptografada fica fora do repositório e da CI. A release publica `.exe`, `.rpm`, respectivas `.sig`, `latest.json` e `SHA256SUMS.txt`. O manifesto atualiza Windows; Fedora usa instalação manual. A assinatura do RPM é externa Minisign, não uma assinatura GPG embutida de repositório DNF.

## Documentação

[Arquitetura](docs/ARCHITECTURE.md) · [Segurança](docs/SECURITY.md) · [Guia de uso](docs/USER_GUIDE.md) · [Fedora](docs/FEDORA_NATIVE.md) · [Integração de APIs](docs/integrations/CLAUDE.md) · [Publicação](docs/RELEASE_CHECKLIST.md)

O suporte Fedora acrescenta uma plataforma à base existente. As funções Windows, seus instaladores e os formatos de cofres são preservados. Testes e limites conhecidos constam nas notas de cada release; testes de build Windows não equivalem a teste visual num computador Windows.
