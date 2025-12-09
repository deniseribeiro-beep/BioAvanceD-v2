# 🌱 Seed do Banco de Dados - BioAvanceD

## 📋 Dados Criados

O script `seed-database.js` popula o banco de dados com as dependências iniciais necessárias para o sistema funcionar.

### ✅ Políticas de Temperatura (4)

1. **Política 1**: Freezer -80°C
   - Min: -85°C
   - Max: -75°C
   - Target: -80°C
   - Hysteresis: 1.0°C
   - Alert Delay: 5 min

2. **Política 2**: Freezer -20°C
   - Min: -25°C
   - Max: -15°C
   - Target: -20°C
   - Hysteresis: 1.0°C
   - Alert Delay: 5 min

3. **Política 3**: Refrigerador 4°C
   - Min: 2°C
   - Max: 8°C
   - Target: 4°C
   - Hysteresis: 0.5°C
   - Alert Delay: 3 min

4. **Política 4**: Nitrogênio Líquido -193°C
   - Min: -196°C
   - Max: -190°C
   - Target: -193°C
   - Hysteresis: 2.0°C
   - Alert Delay: 10 min

### ✅ Equipamentos (5)

1. **Equipamento 1**: Freezer Ultra-Baixa Temperatura -80°C (Modelo A)
2. **Equipamento 2**: Freezer Ultra-Baixa Temperatura -80°C (Modelo B)
3. **Equipamento 3**: Freezer Convencional -20°C (Modelo C)
4. **Equipamento 4**: Refrigerador 4°C (Modelo D)
5. **Equipamento 5**: Tanque de Nitrogênio Líquido -193°C

### ✅ Localizações (13)

- **Freezer -80°C #1**: 4 localizações (blocos, racks, gavetas, caixas)
- **Freezer -80°C #2**: 2 localizações
- **Freezer -20°C**: 2 localizações
- **Refrigerador 4°C**: 2 localizações
- **Nitrogênio Líquido**: 3 localizações (poços)

### ✅ Sensores (6)

1. **SENSOR-001**: Freezer -80°C #1 (Localização 1)
   - Modelo: DS18B20
   - Política: 1 (-80°C)
   - Status: Operacional

2. **SENSOR-002**: Freezer -80°C #1 (Localização 2)
   - Modelo: DS18B20
   - Política: 1 (-80°C)
   - Status: Operacional

3. **SENSOR-003**: Freezer -80°C #2 (Localização 5)
   - Modelo: PT100
   - Política: 1 (-80°C)
   - Status: Operacional

4. **SENSOR-004**: Freezer -20°C (Localização 7)
   - Modelo: DS18B20
   - Política: 2 (-20°C)
   - Status: Operacional

5. **SENSOR-005**: Refrigerador 4°C (Localização 10)
   - Modelo: DS18B20
   - Política: 3 (4°C)
   - Status: Operacional

6. **SENSOR-006**: Nitrogênio Líquido (Localização 12)
   - Modelo: PT100
   - Política: 4 (-193°C)
   - Status: Operacional

## 🚀 Como Executar

```bash
cd backend
npm run seed
```

## ⚠️ Observações

- O script verifica se os dados já existem antes de criar (idempotente)
- Dados existentes não são sobrescritos
- Todos os sensores têm calibração configurada
- Localizações são vinculadas aos equipamentos
- Sensores são vinculados às localizações e políticas

## 📊 Estrutura de Dependências

```
Políticas (4)
    ↓
Equipamentos (5)
    ↓
Localizações (13)
    ↓
Sensores (6) → Vinculados a Localizações e Políticas
```

## ✅ Status

Após executar o seed, o banco terá:
- ✅ 1 usuário (admin)
- ✅ 4 políticas de temperatura
- ✅ 5 equipamentos
- ✅ 13 localizações
- ✅ 6 sensores
- ✅ Logs de sistema

**Total: 30 documentos** no banco principal

