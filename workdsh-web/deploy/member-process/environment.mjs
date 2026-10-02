import {dirname, isAbsolute} from 'node:path';

/** Exact child environment: root-only secrets and caller environment stay outside member processes. */
export function memberEnvironment(user, {nodeExecutable=process.execPath, certificatePath}={}) {
  if (!Number.isSafeInteger(user.uid) || user.uid<=0 || !isAbsolute(user.root) || !isAbsolute(nodeExecutable)) {
    throw new Error('Trusted member directory, UID and Node executable required');
  }
  return {
    ...(certificatePath ? {NODE_EXTRA_CA_CERTS:certificatePath} : {}),
    PATH:dirname(nodeExecutable)+':/usr/local/bin:/usr/bin:/bin',
    HOME:user.root+'/home', USER:'wd-'+user.uid, LANG:'C.UTF-8',
    DSH_HOME:user.root+'/dsh', DSH_AGENTS_HOME:user.root+'/agents',
  };
}
