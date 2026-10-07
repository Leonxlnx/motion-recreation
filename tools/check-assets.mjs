import fs from 'node:fs';
import path from 'node:path';

export function checkAssets(root) {
  const manifestPath=path.join(root,'assets-release.json');
  if(!fs.existsSync(manifestPath))throw new Error('Missing assets-release.json; use a complete repository checkout.');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const missing=manifest.files.filter(file=>{
    try{return fs.statSync(path.join(root,file.path)).size!==file.bytes;}catch{return true;}
  });
  if(missing.length)throw new Error(`${missing.length} texture files need setup. Run npm ci, then npm run setup (about8.6GB).`);
}
