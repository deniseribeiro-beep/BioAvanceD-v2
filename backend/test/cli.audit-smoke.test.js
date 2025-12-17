const { execFile } = require('child_process');
const path = require('path');

function runDailyOnce() {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, '..', 'src', 'workers', 'jobs', 'daily-merkle.job.js');
    // Execute node with -e to require the module and call runOnce
    execFile('node', ['-e', `require('${script.replace(/\\/g, '\\\\')}').runOnce().then(()=>console.log('OK')).catch(err=>{console.error(err); process.exit(2);})`], (err, stdout, stderr) => {
      if (err) return reject({ err, stdout, stderr });
      resolve({ stdout, stderr });
    });
  });
}

(async () => {
  try {
    const { stdout } = await runDailyOnce();
    console.log('SMOKE OK:', stdout.split('\n').slice(0, 20).join('\n'));
    process.exit(0);
  } catch (e) {
    console.error('SMOKE FAIL', e.stderr || e.err || e);
    process.exit(2);
  }
})();