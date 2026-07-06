# KPassword v1.0.0 - mojibake rollback/fix

Restaura arquivos UTF-8 limpos após hotfix de mojibake quebrado.
Inclui correções seguras que já eram necessárias para build e auditoria:

- narrowing de `totpScreenSelection` para TypeScript
- remoção de variáveis antigas não usadas da tela Analítico
- clamp dos campos numéricos de configurações do cofre
- preview TOTP recalculando com o ciclo

Não altera criptografia, updater, backup, TOTP storage, QR reader, Cargo ou versão.
