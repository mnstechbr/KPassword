# KPassword

Gerenciador local de senhas e chaves de API para **Windows e Fedora Linux**, com cofre criptografado e interface compartilhada em Tauri, React e Rust.

As senhas e backups ficam no seu computador. Não é necessária conta nem nuvem para usar o cofre. O **Secrets Bridge**, opcional no Fedora, permite chamadas de API autorizadas: o KPassword usa a chave internamente e devolve somente a resposta ao programa. Essas chamadas enviam o conteúdo solicitado ao provedor e podem gerar cobrança.

## Download e instalação — v1.5.1

[Baixar a versão mais recente](https://github.com/mnstechbr/KPassword/releases/latest) · [Novidades da 1.5.1](docs/releases/v1.5.1.md)

| Plataforma | Instalador | Atualizações |
| --- | --- | --- |
| Windows x64 | `KPassword-Setup-v1.5.1.exe` | Atualizador com assinatura, após a instalação manual da 1.5.0 ou mais recente |
| Fedora 44 x86_64 | `KPassword-1.5.1-1.x86_64.rpm` | O app abre a Release; instalação/atualização pelo DNF |

No Windows, execute o `.exe`. A chave pública de atualização foi renovada na 1.5.0: versões anteriores precisam de uma atualização manual, sem apagar cofres ou dados.

No Fedora, baixe o RPM e execute na pasta do download:

```bash
sudo dnf install ./KPassword-1.5.1-1.x86_64.rpm
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
- Temas escuro, claro e misto, seleção de idioma e bandeja do sistema.
- Windows Hello/PIN/biometria opcional no Windows; senha mestra no Fedora.
- Clipboard, notificações e inicialização automática com configurações próprias por plataforma.
- Adaptação gráfica para Fedora com NVIDIA/Wayland, preservando a versão Windows.

## Secrets Bridge: usar APIs sem entregar a chave

Disponível **localmente no Fedora**. O Bridge não exporta a chave para `.env`, argumentos, clipboard ou para o aplicativo consumidor. É necessário adaptar o projeto: dizer “minha chave está no KPassword” na conversa não configura automaticamente Claude, Codex, um SDK ou outro programa.

1. Cadastre um item **Chave de API** com o identificador do provedor.
2. Em **Segurança → Mostrar opções avançadas**, habilite Secrets Bridge, escolha 24, 48 ou 72 horas e ative a sessão com o cofre desbloqueado. O padrão é 48 horas.
3. Informe ao projeto o **ID da credencial** mostrado no KPassword e o caminho do conector. Esse ID é uma referência, não é a chave secreta.
4. Integre o conector no processo da aplicação. Quando ela solicitar uma chamada, aparece uma **janela própria de aprovação na área de trabalho**, mesmo com o cofre bloqueado na bandeja.
5. Escolha **Aprovar uma vez**, **Recusar** ou **Continuar permitindo**. Fechar o popup ou ignorá-lo por 30 segundos recusa o pedido.

A permissão contínua inclui identidade observada do executável/script, diretório de trabalho, credencial, operação e modelo. **Trocar de tarefa no mesmo contexto não exige nova aprovação.** Mudanças nesses elementos exigem outro pedido. Interpretadores sem script identificável aceitam apenas aprovação única.

**O bloqueio automático da interface e o X não encerram a ponte.** A sessão termina quando expira, o KPassword é encerrado, o computador reinicia, o cofre é editado/trocado ou o usuário bloqueia manualmente/revoga o acesso. Use o ícone da bandeja para **Revogar todos os acessos da ponte**, ou consulte/revogue permissões individuais em Segurança → Mostrar opções avançadas. As autorizações não ficam salvas em disco; reiniciar exige desbloquear e reativar a ponte.

Cada permissão tem um limite de chamadas escolhido no popup (padrão: 10.000), máximo de 60 chamadas/minuto e teto de 8.192 tokens de saída por chamada de geração. Esses limites não são um orçamento monetário: configure também limites no provedor. Um pedido autorizado já em andamento pode terminar após a revogação.

### Conector e exemplo

O RPM inclui `/usr/lib/KPassword/bridge/kpassword_bridge_client.py`. No código-fonte, use `tools/kpassword_bridge_client.py`. Para Python:

```python
import sys
sys.path.insert(0, "/usr/lib/KPassword/bridge")
from kpassword_bridge_client import request_api

resposta = request_api("ID_DA_CREDENCIAL", "responses", {
    "model": "MODELO_DISPONIVEL_NA_SUA_CONTA",
    "input": "Resuma este texto sem informações sensíveis.",
    "max_output_tokens": 1024,
})
```

| Identificador da chave no cofre | Operações |
| --- | --- |
| `OPENAI_API_KEY` | `responses`, `chat`, `embeddings` |
| `DEEPSEEK_API_KEY` | `chat` |
| `ANTHROPIC_API_KEY` | `messages` |

A integração deve chamar esse conector em vez de procurar a chave em arquivos ou pedir que o usuário a cole. [Guia para Claude, Codex e projetos](docs/integrations/CLAUDE.md).

**Limites atuais:** apenas JSON sem streaming; pedidos até 1 MiB e respostas até 4 MiB. Não há endpoint HTTP compatível automaticamente com SDKs, integração automática com aplicativos, suporte a senhas comuns pelo Bridge, cliente Windows do Bridge ou acesso remoto.

## Segurança e privacidade

O cofre é criptografado em repouso. Com a ponte ativa, as chaves de API permanecem disponíveis na memória do backend, mesmo com a interface bloqueada; as demais credenciais e a senha mestra são removidas da interface ao bloquear. O usuário deve revogar a ponte quando não quiser mais autorizar chamadas.

O socket Unix fica em diretório privado (0700), com permissão 0600, sem servidor TCP. A identidade é obtida do processo pelo sistema, incluindo executável, script quando identificável e diretório; o pedido não pode simplesmente declarar “sou Claude”. Isso **não é isolamento contra malware da mesma conta, root, injeção/depuração ou captura de teclado**. Copiar o arquivo criptografado não gera popup. A ponte controla pedidos feitos pelo conector.

Os destinos HTTPS são fixos por provedor, sem redirecionamentos ou proxies do ambiente. Histórico não contém chaves nem conteúdo de pedidos/respostas. Autorizar uma aplicação também autoriza o envio de seus dados ao provedor e o consumo de sua cota.

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
