import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { stopOwnedProcess, cleanOwnedProcessTree } from '../src/owned-process.ts'

it.skipIf(process.platform === 'win32')('kills a real tool descendant that ignores SIGTERM even after its parent exits', async () => {
  const fixture = `const {spawn}=require('node:child_process');
const tool=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{}); console.log(process.pid);setInterval(()=>{},1000)"],{stdio:['ignore','pipe','inherit']});
tool.stdout.on('data',x=>process.stdout.write(x));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`
  const parent = spawn(process.execPath, ['-e', fixture], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let descendant = 0
  try {
    const [data] = await once(parent.stdout!, 'data')
    descendant = Number(String(data).trim()); expect(descendant).toBeGreaterThan(0)
    await stopOwnedProcess(parent)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(() => process.kill(descendant, 0)).toThrow()
    await cleanOwnedProcessTree(parent) // Repeated cleanup cannot target a newly reused group.
  } finally { await cleanOwnedProcessTree(parent) }
}, 15000)
