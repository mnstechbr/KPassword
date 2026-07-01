# Diagnóstico do Cofre

O Diagnóstico do Cofre foi adicionado na versão `0.8.0`.

## Objetivo

A tela Analítico passa a responder de forma mais clara:

- O cofre está saudável?
- Quais credenciais merecem revisão?
- O que deve ser corrigido primeiro?

## Onde aparece

O diagnóstico aparece principalmente em:

- `Analítico`: saúde geral, pontuação e cards de alerta.
- `Cofre`: filtros aplicados ao clicar nos cards de alerta.
- `Detalhe da credencial`: diagnóstico individual da credencial.

## O que é analisado

A primeira versão analisa localmente:

- Senhas fracas.
- Senhas reutilizadas.
- Senhas antigas.
- Senhas vencidas.
- Senhas próximas do vencimento.
- Credenciais sem TOTP/2FA.
- Credenciais incompletas, sem usuário ou sem site.

## Como os dados são armazenados

O diagnóstico não cria uma nova base sensível.

Os dados reais continuam dentro do cofre local criptografado. O diagnóstico é calculado em memória enquanto o cofre está desbloqueado.

## Pontuação

A pontuação começa em 100 e perde pontos conforme os alertas encontrados.

Classificação visual:

- `85-100`: excelente.
- `70-84`: bom.
- `50-69`: atenção.
- `0-49`: crítico.

## Cuidados

O diagnóstico é uma ajuda visual. Ele não substitui boas práticas como usar senhas únicas, ativar 2FA nos serviços importantes e manter backup criptografado atualizado.
