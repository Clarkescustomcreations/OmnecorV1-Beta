import fs from 'fs/promises';
import path from 'path';

const searchRegex = /\bphase2\b/g;
const replacement = 'core_services';

async function walkAndReplace(dir: string) {
  const files = await fs.readdir(dir);
  for (const file of files) {
    if (['node_modules', '.git', 'dist', '.manus-logs'].includes(file)) continue;
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      await walkAndReplace(filePath);
    } else {
      if (!filePath.match(/\.(ts|tsx|js|jsx|json)$/)) continue;
      if (filePath.includes('rename-phase2.ts')) continue;
      
      const content = await fs.readFile(filePath, 'utf8');
      if (searchRegex.test(content)) {
        console.log(`Updating ${filePath}`);
        const newContent = content.replace(searchRegex, replacement);
        await fs.writeFile(filePath, newContent, 'utf8');
      }
    }
  }
}

async function run() {
  const cwd = process.cwd();
  await walkAndReplace(cwd);
  console.log('Refactoring complete.');
}

run().catch(console.error);
