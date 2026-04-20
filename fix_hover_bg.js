const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

function processFile(filePath) {
  if (!filePath.endsWith('.tsx')) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // Fix hover:bg-white dark:bg-white/5 -> hover:bg-gray-200 dark:hover:bg-white/5
  content = content.replace(/hover:bg-white dark:bg-white\/5/g, 'hover:bg-gray-200 dark:hover:bg-white/5');

  if (content !== original) {
    fs.writeFileSync(filePath, content);
    console.log('Updated: ' + filePath);
  }
}

walkDir('src/app', processFile);
walkDir('src/components', processFile);
