// Compatibility entry for local Web preview; Desktop consumes the same locked adapter.
import {fileURLToPath} from 'node:url';
import {ensureNativeWorkbenchFrame} from '../../../scripts/native-workbench-frame-patch.mjs';
export {patchNativeWorkbenchFrame,ensureNativeWorkbenchFrame,verifyNativeWorkbenchFrame} from '../../../scripts/native-workbench-frame-patch.mjs';
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('Profile path required');
 await ensureNativeWorkbenchFrame(process.argv[2],{rollback:process.argv.includes('--rollback')});
}
