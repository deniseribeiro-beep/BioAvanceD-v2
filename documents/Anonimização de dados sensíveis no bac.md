# Anonimização de dados sensíveis no backend (BioAvanceD)

## Visão geral
O backend aplica uma estratégia em camadas:
1. pseudonimização de paciente por `patientID`,
2. minimização de dados por perfil de acesso,
3. anonimização de usuários e payloads nos logs,
4. criptografia em repouso de campos específicos.

## 1) Pseudonimização de paciente
- `generateUniquePatientID` gera ID de 8 dígitos com `crypto.randomInt` e valida unicidade no banco.
- No cadastro, qualquer `patientID` enviado é removido e um novo é gerado no servidor.
- `sanitizePatientForLogs` mantém apenas `{ patientID }` em logs.

## 2) Minimização por autorização (LGPD)
- Usuário sem permissão de cadastro (`createPatient`) recebe somente:
  - `patientID`,
  - `status`,
  - `consentNotifiedAt`,
  - `consentTokenExpiresAt`.
- Dados completos só são retornados para perfis autorizados.

## 3) Anonimização de usuário em auditoria
- `generateAnonId` cria identificador `USR-XXXXXXXX` com SHA-256 + salt.
- `extractUserInfo` já popula `userID`/`userName` com esse identificador.
- Antes de persistir, `anonymizeLogUser` reaplica anonimização para garantir consistência.

## 4) Sanitização de conteúdo dos logs
- `sanitizePayload` remove campos sensíveis (nome, email, CPF, telefone, token, secret, password etc.), inclusive em objetos aninhados e arrays.
- `sanitizeMessage` remove/mascara padrões de email, CPF e telefone em texto livre.
- `log.service` executa sanitização adicional para entidade `Patient`.

## 5) Criptografia de campos sensíveis
- Campos `alphaGal`, `lysoGb3` e `representativeCpf` são criptografados com AES-256-GCM.
- Na leitura, o backend decripta para uso interno autorizado.
- Se `ENCRYPTION_KEY` estiver ausente, há warning e risco de persistência sem criptografia desses campos.

## Conclusão
A proteção é baseada em defesa em profundidade:
- pseudonimização para identidade de paciente,
- anonimização forte para trilha de auditoria,
- minimização por perfil de acesso,
- criptografia seletiva de campos sensíveis.