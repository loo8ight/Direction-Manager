import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));

assert.equal(manifest.version, '1.2.1');
assert.match(manifest.js, /ghostwrite-direction/);
assert.match(source, /directionManagerRequestActiveDirection/);
assert.match(source, /function getActiveDirectionSnapshot/);
assert.match(source, /settings\?\.extensionEnabled/);
assert.match(source, /direction\?\.enabled \|\| !content/);
assert.match(source, /\[WRITE_SUPPORTER_DIRECTION_CONTEXT_INCLUDED\]/);
assert.match(source, /messages\.some\(message =>[\s\S]*?WRITE_SUPPORTER_DIRECTION_MARKER/);
assert.match(source, /document\.addEventListener\(ACTIVE_DIRECTION_REQUEST_EVENT, handleActiveDirectionRequest\)/);

console.log('Direction Manager ghostwriting direction bridge checks: ok');