#!/usr/bin/env node
require('dotenv').config();
const http = require('http');

// Função auxiliar para fazer requisições HTTP
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

(async () => {
  try {
    console.log('1️⃣  Fazendo login...');
    const loginRes = await request('POST', '/api/auth/login', {
      username: 'admin',
      password: 'Admin@123'
    });

    if (loginRes.status !== 200) {
      console.log('❌ Login falhou:', loginRes.status, loginRes.data);
      process.exit(1);
    }

    const token = loginRes.data.token;
    console.log('✅ Login bem-sucedido!');

    console.log('\n2️⃣  Buscando pacientes...');
    const patientsOptions = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/patients',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    };

    const patientsRes = await new Promise((resolve, reject) => {
      const req = http.request(patientsOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data: data });
          }
        });
      });
      req.on('error', reject);
      req.end();
    });

    if (patientsRes.status !== 200) {
      console.log('❌ Falha ao buscar pacientes:', patientsRes.status);
      console.log(patientsRes.data);
      process.exit(1);
    }

    console.log('✅ Pacientes obtidos com sucesso!');
    
    const patients = patientsRes.data.data?.patients || [];
    console.log(`\n📊 Total de pacientes: ${patients.length}`);
    
    if (patients.length > 0) {
      console.log('\n3️⃣  Primeiro paciente:');
      console.log(JSON.stringify(patients[0], null, 2));
      
      if (patients[0].status) {
        console.log('\n✅ STATUS ESTÁ SENDO RETORNADO!');
      } else {
        console.log('\n❌ STATUS NÃO ESTÁ SENDO RETORNADO!');
      }
      
      // Conta quantos têm PENDING_CONSENT
      const pendingCount = patients.filter(p => p.status === 'PENDING_CONSENT').length;
      console.log(`\n📋 Pacientes com status PENDING_CONSENT: ${pendingCount}`);
    }
  } catch (err) {
    console.error('❌ Erro:', err.message);
    process.exit(1);
  }
})();
