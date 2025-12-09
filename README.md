# Sistema de Gerenciamento de Amostras Biológicas

Sistema React desenvolvido com base no diagrama UML de classes para gerenciamento de pacientes, amostras biológicas, resultados de laboratório, equipamentos, monitoramento de temperatura, sensores, políticas e logs do sistema.

## 🚀 Tecnologias

- **React 18** - Biblioteca JavaScript para construção de interfaces
- **TypeScript** - Superset JavaScript com tipagem estática
- **Vite** - Build tool moderna e rápida
- **React Router** - Roteamento para aplicações React
- **Lucide React** - Ícones modernos e leves

## 📋 Funcionalidades

### Módulos Principais

1. **Dashboard** - Visão geral do sistema com estatísticas
2. **Pacientes** - Gerenciamento completo de pacientes com informações clínicas
3. **Amostras** - Controle de amostras biológicas (tipo, origem, protocolo, localização)
4. **Resultados** - Gerenciamento de resultados de análises laboratoriais
5. **Equipamentos** - Cadastro e controle de equipamentos de armazenamento
6. **Temperatura** - Monitoramento em tempo real de temperatura
7. **Sensores** - Gerenciamento de sensores de temperatura
8. **Políticas** - Configuração de políticas e limites de temperatura
9. **Usuários** - Gerenciamento de usuários e permissões
10. **Logs** - Registro de atividades e eventos do sistema

## 🏗️ Estrutura do Projeto

```
BIO/
├── src/
│   ├── components/
│   │   ├── Layout/          # Componentes de layout (Sidebar, Header)
│   │   └── UI/              # Componentes reutilizáveis (Button, Card, Table, Modal, Input)
│   ├── pages/               # Páginas principais do sistema
│   ├── types/
│   │   └── models.ts        # Modelos TypeScript baseados no diagrama UML
│   ├── App.tsx              # Componente principal com rotas
│   ├── App.css              # Estilos globais
│   └── main.tsx             # Ponto de entrada da aplicação
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 📦 Instalação

1. Instale as dependências:
```bash
npm install
```

2. Inicie o servidor de desenvolvimento:
```bash
npm run dev
```

3. Acesse a aplicação em `http://localhost:5173`

## 🏃 Scripts Disponíveis

- `npm run dev` - Inicia o servidor de desenvolvimento
- `npm run build` - Cria a build de produção
- `npm run preview` - Visualiza a build de produção

## 🎨 Design

O sistema utiliza um design moderno e limpo com:
- Paleta de cores consistente
- Interface responsiva
- Componentes reutilizáveis
- Navegação intuitiva com sidebar
- Modais para formulários
- Tabelas interativas

## 📊 Modelos de Dados

O sistema implementa os seguintes modelos baseados no diagrama UML:

- **Patient** - Informações completas do paciente
- **Sample** - Dados das amostras biológicas
- **Result** - Resultados de análises
- **Equipment** - Equipamentos de armazenamento
- **Location** - Localização física das amostras
- **User** - Usuários do sistema
- **SpecificUser** - Usuários com MFA
- **Temperature** - Leituras de temperatura
- **Sensor** - Sensores de monitoramento
- **Policy** - Políticas de temperatura
- **Log** - Logs de auditoria

## 🔄 Próximos Passos

Para integrar com um backend:

1. Configure as URLs da API em um arquivo de configuração
2. Substitua os dados mockados por chamadas à API usando axios
3. Implemente tratamento de erros e loading states
4. Adicione autenticação e autorização
5. Implemente validações de formulário mais robustas

## 📝 Licença

Este projeto foi desenvolvido para fins educacionais e de demonstração.


"# BioAvanced" 
