require('dotenv').config();
const http = require('http');

async function testAPI() {
  try {
    // Login
    console.log('Fazendo login...');
    const loginData = JSON.stringify({ username: 'admin', password: 'Admin@123' });
    
    const loginReq = http.request('http://localhost:3000/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': loginData.length
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        try {
          const loginResponse = JSON.parse(data);
          const token = loginResponse.token;
          console.log('✅ Login bem-sucedido. Token:', token.substring(0, 20) + '...');
          
          // Get patients
          console.log('\nBuscando pacientes...');
          const patientsReq = http.request('http://localhost:3000/patients', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }, (res2) => {
            let data2 = '';
            res2.on('data', chunk => data2 += chunk);
            res2.on('end', () => {
              try {
                const patientsResponse = JSON.parse(data2);
                console.log('✅ Pacientes obtidos com sucesso!');
                
                if (patientsResponse.data && patientsResponse.data.patients) {
                  const firstPatient = patientsResponse.data.patients[0];
                  console.log('\nPrimeiro paciente:');
                  console.log(JSON.stringify(firstPatient, null, 2));
                  
                  if (firstPatient.status) {
                    console.log('\n✅ Status está sendo retornado!');
                  } else {
                    console.log('\n❌ Status NÃO está sendo retornado!');
                  }
                } else {
                  console.log('Resposta:', JSON.stringify(patientsResponse, null, 2));
                }
              } catch (err) {
                console.error('Erro ao parsear resposta:', err.message);
                console.log('Resposta:', data2.substring(0, 200));
              }
            });
          });
          
          patientsReq.on('error', err => console.error('Erro na requisição de pacientes:', err));
          patientsReq.end();
        } catch (err) {
          console.error('Erro ao parsear login:', err.message);
        }
      });
    });
    
    loginReq.on('error', err => console.error('Erro na requisição de login:', err));
    loginReq.write(loginData);
    loginReq.end();
  } catch (error) {
    console.error('Erro:', error);
    process.exit(1);
  }
}

testAPI();
