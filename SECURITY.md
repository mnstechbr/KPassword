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

Windows Hello/PIN/biometria no KPassword é desbloqueio rápido opcional no dispositivo, protegido pelo contexto local do Windows/DPAPI do usuário. Não substitui a senha mestra e não deve ser tratado como segundo fator separado.

## Observações sobre QR, TOTP e CSV

A leitura de QR Code/TOTP é feita localmente pelo app. Não envie senhas, QR Codes, TOTP secrets ou cofres reais em relatórios de bug.

CSV exportado não é criptografado e deve ser usado apenas para migração temporária.
