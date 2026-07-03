# Consentimento e eConsent

## Princípios

O consentimento deve ser versionado, vinculável ao participante e aplicável às ações realizadas sobre dados e amostras. A decisão atual deriva do histórico de versões, assinaturas, permissões, revogações e expirações.

## Estados essenciais

- rascunho;
- aguardando assinatura;
- visualizado;
- assinado;
- parcialmente aceito;
- recusado;
- revogado;
- expirado;
- substituído por nova versão;
- falha de entrega.

## Granularidade

As permissões podem abranger uso no projeto atual, pesquisas futuras, compartilhamento, recontato, uso de dados clínicos, material biológico, dados genéticos, retenção e descarte. Cada mudança deve criar novo evento ou snapshot, sem sobrescrever a decisão anterior.

## Enforcement

Antes de disponibilizar, exportar, compartilhar, retirar ou declarar uma amostra elegível, o sistema deve verificar a versão do termo, o estado, a validade e as permissões aplicáveis.

## Portal do participante

O participante deve poder visualizar termos, assinar, recusar, revogar, alterar permissões permitidas, consultar o histórico e obter uma cópia. Usuários administrativos podem monitorar, mas não alterar escolhas do participante.
