const fs = require('fs');
const path = require('path');

const envContent = `PORT=3000
MONGO_URI=mongodb://localhost:27017/bioavanced_dev
MONGO_DB=bioavanced
MONGO_DB_NOVO=bioavanced_novo
JWT_SECRET=change-me
NODE_ENV=development
`;

const envPath = path.join(__dirname, '.env');

try {
  // Verifica se .env já existe
  if (fs.existsSync(envPath)) {
    console.log('⚠️  Arquivo .env já existe!');
    console.log('📝 Verifique se a connection string está correta.');
    console.log('\nConteúdo atual:');
    console.log(fs.readFileSync(envPath, 'utf8'));
  } else {
    // Cria o arquivo .env
    fs.writeFileSync(envPath, envContent);
    console.log('✅ Arquivo .env criado com sucesso!');
    console.log('📋 Connection string do MongoDB Atlas configurada.');
  }
  
  console.log('\n📌 Próximos passos:');
  console.log('   1. Ajuste as variáveis locais conforme o ambiente');
  console.log('   2. Execute: npm install');
  console.log('   3. Execute: npm run dev');
} catch (error) {
  console.error('❌ Erro ao criar arquivo .env:', error.message);
  console.log('\n📝 Crie manualmente o arquivo backend/.env com:');
  console.log(envContent);
}


