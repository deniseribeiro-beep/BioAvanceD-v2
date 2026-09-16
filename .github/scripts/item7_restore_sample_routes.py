from pathlib import Path
import subprocess

path = 'api/backend/src/interface/routes/sample.routes.js'
base = 'af3a34ba00f565e9f6cf47816964600ca6d15e27'
result = subprocess.run(['git', 'show', f'{base}:{path}'], check=True, capture_output=True, text=True)
text = result.stdout
old = '      resourceId: sampleId,\n'
new = '      resourceId: specimenId,\n'
if old not in text:
    raise SystemExit('expected label audit resourceId legacy reference not found in base file')
text = text.replace(old, new, 1)
Path(path).write_text(text, encoding='utf-8')
