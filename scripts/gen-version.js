#!/usr/bin/env node
// Genera src/environments/version.ts con el hash corto de git actual, antes
// de cada build — así la UI puede mostrar qué commit tiene realmente cargado
// el navegador, sin depender de recordar actualizar un número a mano.
// Se engancha a "postinstall" (corre siempre que el deploy hace npm install,
// sin importar si el build después se invoca con `npm run build` o `ng
// build` directo) y a "prebuild" (para quien use `npm run build` en local).
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function run(cmd, fallback) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback;
  }
}

const hash = run('git rev-parse --short HEAD', 'sin-git');
const builtAt = new Date().toISOString();

const outPath = path.join(__dirname, '..', 'src', 'environments', 'version.ts');
const content = `// Generado automáticamente por scripts/gen-version.js en cada npm install /
// npm run build — no editar a mano, se sobrescribe.
export const VERSION = {
  hash: '${hash}',
  builtAt: '${builtAt}',
};
`;

fs.writeFileSync(outPath, content);
console.log(`[gen-version] ${hash} @ ${builtAt}`);
