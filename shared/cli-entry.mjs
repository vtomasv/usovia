// Normalize Node argv for yargs when Node is hosted by a packaged Electron app.
// Electron's run-as-node mode retains process.versions.electron; yargs would
// otherwise treat the CLI filename as a positional prompt.
import {realpath} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const [entry,...args]=process.argv.slice(2);
if(!entry)throw new Error('Falta la ruta del CLI.');
const file=await realpath(entry);
process.defaultApp=true;
// Keep Gemini in this normalized embedded Node process instead of respawning
// its original entry without the Electron argv compatibility initialization.
process.env.GEMINI_CLI_NO_RELAUNCH='true';
process.argv=[process.execPath,file,...args];
await import(pathToFileURL(file).href);
