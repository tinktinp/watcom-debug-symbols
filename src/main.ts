import { readFile } from 'node:fs/promises';
import { parseWatcomDebugInfo } from './watcom-debug-parser.ts';

const filename = process.argv[2];

const buffer = await readFile(filename);


const result = parseWatcomDebugInfo(buffer.buffer);
process.stdout.write(JSON.stringify(result, null, 4));