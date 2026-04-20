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

  // Fix Light Mode Text Colors (gray-300, gray-200, gray-400 missing)
  content = content.replace(/text-gray-300(?![\w])/g, 'text-gray-700 dark:text-gray-300');
  content = content.replace(/text-gray-200(?![\w])/g, 'text-gray-800 dark:text-gray-200');
  // Just in case we missed some gray-400
  content = content.replace(/(?<!dark:)text-gray-400(?![\w])/g, 'text-gray-600 dark:text-gray-400');
  content = content.replace(/(?<!dark:)text-white(?![\w])/g, 'text-slate-900 dark:text-white');

  // Synchronize Buttons to Violet Gradient
  const buttonRegex1 = /bg-white text-black hover:scale-\[1\.02\] shadow-lg shadow-white\/5 hover:bg-gray-100/g;
  const buttonRegex2 = /bg-white text-black hover:scale-\[1\.02\] shadow-lg shadow-white\/5/g;
  const buttonRegex3 = /bg-white text-black py-3\.5 px-4 rounded-xl hover:bg-gray-100 hover:scale-\[1\.02\] transition-all duration-300 font-bold shadow-lg shadow-white\/5/g;
  const buttonRegex4 = /bg-violet-600 hover:bg-violet-500 text-black/g;
  
  const violetBtn = 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white hover:scale-[1.02] shadow-lg shadow-violet-500/30 transition-all';
  const loginBtn = 'w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl transition-all duration-300 font-bold ' + violetBtn;

  content = content.replace(buttonRegex1, violetBtn);
  content = content.replace(buttonRegex2, violetBtn);
  content = content.replace(buttonRegex3, loginBtn);
  content = content.replace(buttonRegex4, violetBtn);

  if (content !== original) {
    fs.writeFileSync(filePath, content);
    console.log('Updated: ' + filePath);
  }
}

walkDir('src/app', processFile);
walkDir('src/components', processFile);
