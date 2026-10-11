# Validação local da ponte de chamadas — 1.5.0

Dados exclusivamente fictícios em perfil isolado; nenhum cofre ou segredo real.

- Build nativo Fedora com RPM; conector presente em `/usr/lib/KPassword/bridge/`.
- 137 testes frontend, 70 testes Rust, 6 testes do conector Python aprovados.
- GUI real capturada: chave, provedor, operação, caminho real do Python, PID e hash;
  hash quebra linha dentro do popup, sem sobreposição; permissão contínua desmarcada.
- Nenhuma resposta ao popup por 30 s: recusa, popup removido, nenhuma chamada.
- Aprovação: chamada HTTPS à OpenAI com chave inválida fictícia; HTTP 401 retornado
  em envelope contendo apenas `ok`, `status`, `body`; chave fictícia ausente.
  Não valida inferência real nem outros provedores.
- Permitir nesta sessão: duas chamadas fictícias retornaram HTTP 401 após uma
  única aprovação; sem credencial nas respostas.
- Bloquear: duas novas solicitações foram recusadas imediatamente (`ok: false`).
- Diretório/socket de teste com modos 0700/0600; identificação por SO_PEERCRED.

Sem integração automática de apps ou VPS. Python/Node identificam o interpretador,
não o projeto; acesso persistente limitado à sessão, chave, binário/hash e operação.
A proteção não é um sandbox contra malware da mesma conta. Windows preservado;
compilação Windows e CI da revisão final ainda precisam concluir antes da publicação.
