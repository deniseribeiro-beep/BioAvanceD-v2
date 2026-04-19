# Contexto SPREC/MIABIS para o BioAvanceD

O SPREC (Standard PREanalytical Code) e um codigo para amostras liquidas que possui sete elementos separados por hifens (LEHMANN et al., 2012). Exemplo de um codigo SPREC: `BLD-EDT-A-RT-A-A-A`.

O sistema deve cruzar as letras com a tabela oficial da ISBER (CAMPBELL et al., 2018):

- BLD = Sangue (Blood)
- EDT = Tubo com EDTA
- A (1o A) = Tempo de isquemia (Pre-centrifugacao) < 2 horas
- RT = Centrifugacao em Temperatura Ambiente (Room Temperature)
- A (2o A) = Tempo pos-centrifugacao < 1 hora
- A (3o A) = Tubo de armazenamento criogenico
- A (4o A) = Armazenado a -85 C

O BioAvanceD deve possuir um Dicionario de Dados SPREC embarcado, garantindo que a interoperabilidade internacional seja traduzida para uma interface human-readable.

A literatura internacional (ISBER/MIABIS) nao fornece uma formula matematica fechada para a qualificacao de uma amostra. No entanto, determina os padroes e variaveis aceitas para validar a amostra para um estudo (CAMPBELL et al., 2018; MERINO-MARTINEZ et al., 2016). Desta forma, propoe-se um Modelo de Pontuacao por Penalidade, partindo de um padrao de uma amostra considerada adequada (100 pontos) e subtraindo pontos conforme as condicoes pre-analiticas fogem do ideal.

## Formula Base

$$
S_{final} = S_{max} - (P_{isq} + P_{temp})
$$

Onde:

- $S_{final}$ = Score final da amostra
- $S_{max}$ = 100 (Condicao ideal)
- $P_{isq}$ = Fator de penalidade por tempo de isquemia (fria/quente)
- $P_{temp}$ = Fator de penalidade por desvio de temperatura

## Tabela de Referencia para o Algoritmo

### 1. Fator Isquemia ($P_{isq}$)

- < 2 horas = 0 (Sem penalidade)
- 2 a 4 horas = 15 pontos de penalidade
- 4 a 12 horas = 30 pontos de penalidade
- Desconhecido = 50 pontos de penalidade (Aplicacao da Gestao de Risco)

### 2. Fator Temperatura ($P_{temp}$)

- Temperatura ideal (ex: Gelo seco/Refrigerado para RNA) = 0 penalidade
- Temperatura ambiente (18-25 C) = 20 pontos de penalidade
- Desconhecida = 50 pontos de penalidade

## Classificacao de Qualidade

O sistema converte os pontos na Badge MIABIS/Qualidade:

- Categoria A (Alta Qualidade): $S_{final} >= 85$. Amostra apta para estudos moleculares sensiveis (RNA/Proteomica).
- Categoria B (Qualidade Aceitavel): $65 <= S_{final} < 85$. Apta para DNA e ensaios bioquimicos gerais, mas com ressalvas para RNA.
- Categoria C (Quarentena): $S_{final} < 65$. Amostra comprometida. Bloqueada para estudo sem aprovacao previa do comite.

Se os dados forem desconhecidos, a penalidade e de 100, jogando a amostra direto para a Categoria C.

## Justificativas Tecnico-Cientificas

### 1. Justificando o Fator Tempo de Isquemia ($P_{isq}$)

A justificativa e baseada na cinetica de degradacao molecular.

A marca de < 2 horas (0 penalidade): a literatura internacional (diretrizes da ISBER - International Society for Biological and Environmental Repositories e NCI - National Cancer Institute) estabelece que para analises sensiveis, como o sequenciamento de RNA (Transcriptomica) e Proteomica, o tecido/sangue deve ser estabilizado o mais rapido possivel (CAMPBELL et al., 2018; MOORE et al., 2011). Apos 2 horas, o RNA Integrity Number (RIN) comeca a cair significativamente devido a hipoxia celular e morte celular programada (SCHROEDER et al., 2006).

A marca de 2 a 4 horas (15 pontos): e uma janela aceitavel para DNA genomico (que e muito mais estavel que o RNA) e ensaios bioquimicos padrao. A penalidade de 15 pontos tira a amostra do padrao A, alertando o pesquisador de que a amostra serve para DNA, mas pode ter vieses se usada para RNA.

Mais de 4 horas (30 pontos): a degradacao ja e severa para multiplos biomarcadores (MOORE et al., 2011).

### 2. Justificando o Fator Temperatura ($P_{temp}$)

A justificativa baseia-se na termodinamica e atividade enzimatica.

Temperatura Ambiente / 18-25 C (20 pontos): nessa temperatura, enzimas endogenas como RNases, DNases e proteases estao altamente ativas, acelerando a clivagem das moleculas (BETSOU et al., 2010). A penalidade de 20 pontos e alta porque a quebra da cadeia de frio e um dos eventos mais destrutivos para a fidelidade da amostra.

Refrigerado/Gelo Seco (0 penalidade): o frio inibe a atividade enzimatica, justificando a nota maxima de preservacao (CAMPBELL et al., 2018).

### 3. Justificando o Peso Desconhecido (50 pontos)

Essa justificativa baseia-se na Gestao da Qualidade e normas ISO. Segundo a ISO 20387 (Biotecnologia - Biobanking - General requirements for biobanking), a rastreabilidade e inegociavel (INTERNATIONAL ORGANIZATION FOR STANDARDIZATION, 2018). Dados nao rastreaveis representam o maior nivel de risco para a reprodutibilidade cientifica.

O valor de 50 pontos nao e aleatorio. Se o tempo for desconhecido (50 pontos) ou a temperatura for desconhecida (50 pontos), o score final da amostra cai automaticamente para 50 (pois $100 - 50 = 50$). Como 50 e menor que o limiar da Categoria C (65), a amostra e matematicamente forcada para a Quarentena. Trata-se de um mecanismo de seguranca embutido no algoritmo.

### 4. Justificando os Limiares (85, 65)

Rule-Based Expert System: esses limiares sao propostos como um modelo conservador para mitigacao de risco (SHORTLIFFE; CIMINO, 2021).

- O limiar de 85 para a Categoria A exige que a amostra tenha sofrido pouquissimo ou nenhum desvio (ex: isquemia curta sem quebra de temperatura: $100 - 15 = 85$).
- O limiar de 65 para rejeicao (Quarentena) garante que nenhuma amostra que tenha sofrido multiplos eventos deleterios (ex: mais de 4 horas em temperatura ambiente: $100 - 30 - 20 = 50$) passe despercebida e seja enviada para um sequenciamento caro e sem resultado satisfatorio.

## Referencias

BETSOU, F. et al. Standard preanalytical coding for biospecimens: defining the sample PREanalytical code. *Cancer Epidemiology, Biomarkers & Prevention*, v. 19, n. 4, p. 1004-1011, 2010.

CAMPBELL, L. D. et al. The 2018 Revision of the ISBER Best Practices: Summary of Changes and the Editorial Team's Development Process. *Biopreservation and Biobanking*, v. 16, n. 1, p. 3-6, 2018.

INTERNATIONAL ORGANIZATION FOR STANDARDIZATION. *ISO 20387:2018: Biotechnology - Biobanking - General requirements for biobanking*. Genebra: ISO, 2018.

LEHMANN, S. et al. Standard preanalytical coding for biospecimens: review and implementation of the Sample PREanalytical Code (SPREC). *Biopreservation and Biobanking*, v. 10, n. 4, p. 366-374, 2012.

MERINO-MARTINEZ, R. et al. Toward Global Biobank Integration by Implementation of the Minimum Information About BIobank Data Sharing (MIABIS 2.0 Core). *Biopreservation and Biobanking*, v. 14, n. 4, p. 298-306, 2016.

MOORE, H. M. The NCI Biospecimen Research Network. *Biotech Histochem*. 2012 Jan;87(1):18-23. doi: 10.3109/10520295.2011.591833. Epub 2011 Jul 12. PMID: 21745162.

SCHROEDER, A. et al. The RIN: an RNA integrity number for assigning integrity values to RNA measurements. *BMC Molecular Biology*, v. 7, n. 3, 2006.

SHORTLIFFE, E. H.; CIMINO, J. J. (ed.). *Biomedical Informatics: Computer Applications in Health Care and Biomedicine*. 5. ed. Cham: Springer, 2021. DOI: https://doi.org/10.1007/978-3-030-58721-5.