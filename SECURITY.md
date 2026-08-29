# Segurança do KPassword

O KPassword é um gerenciador de senhas local/offline. O cofre é criptografado no computador do usuário e a senha mestra não é enviada, armazenada em servidor ou recuperável pelo projeto.

## Como reportar vulnerabilidades

Envie um relatório privado para o mantenedor do projeto. Inclua:

- versão do KPassword;
- sistema operacional;
- passos de reprodução;
- impacto esperado;
- arquivos de teste sem dados reais, quando necessário.

Não envie cofres reais, senhas, chaves, TOTP secrets, anexos privados ou dados pessoais no relatório.

## Escopo

Estão no escopo:

- criptografia do cofre local;
- `cryptoVersion 2` com Argon2id, AES-256-GCM e AAD no backend Rust;
- migração de cofres legados para o formato atual;
- backups criptografados;
- verificação de backup sem restauração;
- atualizador assinado;
- validação local de assets de release e `SHA256SUMS.txt`;
- permissões Tauri;
- Windows Hello como conveniência local;
- tratamento de arquivo corrompido ou adulterado.

Fora do escopo:

- computadores já comprometidos por malware com captura de teclado, tela, clipboard ou memória;
- perda da senha mestra;
- perda de backups pelo usuário;
- engenharia social fora do app.

## Política de resposta

O projeto ainda não promete SLA formal. Relatórios críticos devem ser tratados com prioridade e corrigidos antes de divulgação pública sempre que possível.

## Severidade

- Crítica: exposição ou descriptografia do cofre sem senha mestra, execução remota via update, vazamento de chave privada de assinatura.
- Alta: bypass de autenticação local, falha de integridade do cofre, restauração insegura de backup.
- Média: vazamento parcial por logs, permissões excessivas, falha de limpeza de clipboard.
- Baixa: mensagens confusas, endurecimento defensivo, documentação incompleta.

## Limites importantes

Nenhum gerenciador local consegue proteger totalmente dados enquanto o computador está infectado. Malware pode capturar tela, teclado, clipboard, arquivos e memória de processos em execução. O KPassword protege dados em repouso, mas o ambiente do usuário continua sendo parte essencial da segurança.

## Observações sobre Windows Hello

Windows Hello/PIN/biometria no KPassword é desbloqueio rápido opcional no dispositivo. Não substitui a senha mestra e não deve ser tratado como segundo fator separado. A seção **Windows Hello e DPAPI** descreve em detalhe o que esse mecanismo protege e o que não protege.

## Observações sobre QR, TOTP e CSV

A leitura de QR Code/TOTP é feita localmente pelo app. Não envie senhas, QR Codes, TOTP secrets ou cofres reais em relatórios de bug.

No fluxo de recorte do Windows, o app aciona Win + Shift + S, lê a imagem do clipboard localmente e não grava o recorte em disco. Quando uma credencial já tem 2FA, um QR novo exige confirmação antes de substituir o segredo existente.

CSV exportado não é criptografado e deve ser usado apenas para migração temporária.


## Assinatura e updater

A chave privada usada para assinar o updater deve ficar fora do repositório, protegida por senha forte e com acesso restrito ao mantenedor. Scripts de release não devem fazer `git add`, `git commit`, `git push` ou instalar dependências automaticamente. A publicação deve anexar apenas instalador, assinatura, `latest.json` e `SHA256SUMS.txt` validados localmente.

## Windows Hello e DPAPI

Windows Hello no KPassword é uma **conveniência local**, não uma camada adicional de criptografia. Esta seção descreve o mecanismo com precisão para que a decisão de ativá-lo seja informada.

### Como funciona hoje (formato de registro v1)

Quando o usuário ativa o Windows Hello para um cofre, o KPassword grava um arquivo `.kphello` em `%APPDATA%` contendo:

- **a própria senha mestra**, não uma chave derivada nem um token de escopo limitado;
- protegida por **DPAPI (`CryptProtectData`) com escopo de usuário do Windows**;
- com uma entropia adicional que é **derivável publicamente** — ela é calculada a partir do nome do cofre e o código-fonte é aberto, portanto não constitui segredo.

No desbloqueio, o `UserConsentVerifier` exibe o prompt do Windows Hello e o KPassword só prossegue se a verificação retornar sucesso.

### O que isso protege

- **Cópia do arquivo para outra máquina ou outro usuário Windows:** protegido. A chave DPAPI é derivada do perfil do usuário e não acompanha o arquivo.
- **Acesso ao disco sem a sessão do usuário:** protegido pelo mesmo mecanismo (e reforçado por BitLocker, quando ativo).

### O que isso NÃO protege — limitação importante

**A verificação do Windows Hello não participa criptograficamente da decifragem.** Ela controla o fluxo da aplicação: o código chama `verify_user()` e, se aprovado, chama `CryptUnprotectData`. Os dois mecanismos são independentes — nenhum bit do resultado da verificação entra na operação DPAPI.

A consequência prática é que **outro processo executado como o mesmo usuário Windows pode, em princípio, recuperar a senha mestra lendo o `.kphello` e chamando `CryptUnprotectData` com a entropia pública, sem completar nenhum prompt do Windows Hello.**

Portanto: ativar o Windows Hello troca "a senha mestra existe apenas na cabeça do usuário" por "a senha mestra também existe em disco, recuperável por código executando na sua conta Windows". Em uma máquina saudável isso é uma troca razoável por conveniência. Em uma máquina com malware ativo, não é uma barreira.

A senha mestra permanece o **método independente de recuperação**: nenhuma falha, remoção ou corrupção do registro Windows Hello impede o acesso ao cofre.

### Estados do registro

O KPassword classifica o registro como `disabled`, `configured`, `stale` (existe registro sem cofre correspondente) ou `invalid`. O desbloqueio rápido só é oferecido no estado `configured`. Registros órfãos são removidos ao criar um cofre de mesmo nome, e um registro cujo segredo não abre o cofre atual é **isolado** (renomeado, não apagado) em vez de continuar sendo oferecido. Essa classificação é operacional: **ela não prova vínculo criptográfico entre o registro e o cofre**, propriedade que o formato v1 não oferece.

### Por que ainda é assim

Uma implementação mais forte exigiria que o material de desbloqueio dependesse criptograficamente da autenticação do Windows Hello. Investigamos as APIs oficiais da Microsoft para isso e nenhuma alternativa atende hoje, nas versões de Windows que o KPassword suporta:

- `KeyCredentialManager` + `RequestSignAsync` derivaria uma chave da assinatura, mas a documentação oficial **se contradiz** sobre o esquema de assinatura (a referência da API documenta RSA-PSS, que é randomizado; o guia do Windows Hello mostra PKCS#1 v1.5, que é determinístico). Construir um formato persistente sobre essa ambiguidade arriscaria quebrar o desbloqueio de todos os usuários numa atualização do Windows.
- `RequestDeriveSharedSecretAsync` não possui documentação de protocolo e existe apenas em versões recentes do Windows 11.
- O provedor CNG "Microsoft Passport" depende de propriedade não documentada para exigir o gesto.
- DPAPI-NG não possui descritor de proteção baseado em presença do usuário.
- WebAuthn PRF (`hmac-secret`) é a solução tecnicamente correta e padronizada, mas o suporte no autenticador de plataforma do Windows é recente demais para a base instalada.

Uma futura implementação mais forte depende de uma primitiva Windows **documentada** que forneça material reproduzível condicionado à autenticação do Windows Hello. Enquanto ela não existir de forma estável, preferimos manter o mecanismo atual com a limitação documentada a construir criptografia sobre comportamento não especificado.

## Dependências transitivas

Dependências Rust transitivas devem ser acompanhadas com `cargo audit` quando disponível e com `cargo tree`, especialmente bibliotecas usadas por Tauri/plugins. Overrides manuais de dependências transitivas não devem ser aplicados sem confirmar compatibilidade, para evitar corrigir um advisory criando instabilidade de runtime.

## Bandeja, inicialização e memória

A inicialização com Windows é opcional e usa registro do usuário atual em HKCU. Ao iniciar com `--startup`, o app abre na bandeja. Ao ir para a bandeja, o cofre é bloqueado conforme configuração e o app solicita ao Windows redução do working set do processo principal. Processos filhos do WebView2 continuam sob controle do runtime do Windows.

## Diagnóstico do app

O diagnóstico local do KPassword mostra apenas informações operacionais como versão, status de inicialização, bandeja, Windows Hello, backups e updater. Ele não deve exibir senhas, códigos TOTP, anexos, chave do cofre ou conteúdo sensível.

O Windows pode agrupar subprocessos do Microsoft WebView2 como Gerenciador WebView2. Isso é uma característica do runtime usado por apps Tauri e não significa que existam duas cópias completas do KPassword abertas.
