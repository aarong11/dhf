const {compile} = require('node-latex-compiler');
const path = require('path');

async function main() {
  console.log('Starting compilation...');
  try {
    const result = await compile({
      texFile: path.join(__dirname, 'paper', 'main.tex'),
    });
    console.log('Result:', JSON.stringify(result).slice(0, 5000));
    console.log('Exit code:', result.exitCode);
    if (result.stdout) console.log('Stdout:', result.stdout.slice(-3000));
    if (result.stderr) console.log('Stderr:', result.stderr.slice(-3000));
  } catch(e) {
    console.error('Error:', e.message);
    if (e.log) console.error('Log:', e.log.slice(-3000));
    if (e.stderr) console.error('Stderr:', e.stderr);
  }
}
main();
