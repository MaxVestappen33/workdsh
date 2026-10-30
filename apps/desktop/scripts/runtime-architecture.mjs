/** Install native optional dependencies for both the build host and packaged target. */
export function runtimeArchitecture(env=process.env,platform=process.platform,hostArch=process.arch){
 const targetPlatform=env.WORKDSH_TARGET_PLATFORM??platform;
 const targetArch=env.WORKDSH_TARGET_ARCH??(targetPlatform==='darwin'?(env.WORKDSH_MAC_ARCH??hostArch):hostArch);
 if(!['x64','arm64'].includes(targetArch))throw Error('Unsupported packaged runtime architecture: '+targetArch);
 if(!['darwin','win32','linux'].includes(targetPlatform))throw Error('Unsupported packaged runtime platform: '+targetPlatform);
 return {platform:targetPlatform,hostPlatform:platform,hostArch,targetArch,cpus:[...new Set([hostArch,targetArch])]};
}
export function runtimeArchitectureYaml(architecture){
 return 'supportedArchitectures:\n  os:\n    - '+architecture.platform+'\n  cpu:\n'+architecture.cpus.map(cpu=>'    - '+cpu+'\n').join('');
}
/** Locked runtime target name, honouring an explicit cross-build selection. */
export function packagedTarget(env=process.env,platform=process.platform,hostArch=process.arch){
 const architecture=runtimeArchitecture(env,platform,hostArch);
 if(architecture.platform==='darwin')return 'mac-'+architecture.targetArch;
 if(architecture.platform==='win32')return architecture.targetArch==='x64'?'win-x64':undefined;
 return 'linux-'+architecture.targetArch;
}
/** True when the packaged platform is not the host platform. */
export function isCrossTarget(env=process.env,platform=process.platform){
 return (env.WORKDSH_TARGET_PLATFORM??platform)!==platform;
}
