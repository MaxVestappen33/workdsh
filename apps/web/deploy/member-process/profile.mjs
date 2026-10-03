/** Owned composition only: official bundles retain their complete published patches. */
export function renderMemberPatch(user, {backendUrl, bridgeUrl}) {
  const quote = value => JSON.stringify(String(value));
  if (!user.id || !user.org || !user.root || new URL(backendUrl).protocol !== 'https:') {
    throw new Error('Fixed authenticated member and HTTPS backend required');
  }
  const identity = `        backendUrl: ${quote(backendUrl)}
        authFile: ${quote(user.root+'/login')}
        principalId: ${quote(user.id)}
        organizationId: ${quote(user.org)}
`;
  let patch = `- insert:
    - id: workdsh-process-identity
      name: workdsh-provider-identity-enterprise/process
      config:
${identity}- id: workspace-controller
  config:
    documentsDirectory: ${quote(user.root+'/workspace')}
- id: computer-use
  disabled: true
- id: computer-use-cua-driver-native
  disabled: true
- id: browser-use
  disabled: true
- id: browser-use-playwright-mcp
  disabled: true
- id: workdsh-session-access
  config:
    autoBindFixedMemberSessions: true
- id: workdsh-tool-access
  config:
    autoBindPersonalSessions: false
    autoBindFixedMemberSessions: true
`;
  if (bridgeUrl) {
    const bridge = new URL(bridgeUrl);
    if (bridge.protocol !== 'http:' || bridge.hostname !== '127.0.0.1' || !bridge.port || bridge.pathname !== '/' || bridge.search || bridge.hash || bridge.username || bridge.password) {
      throw new Error('Fixed loopback member session bridge required');
    }
    patch += `- id: session-persistence-jsonl
  disabled: true
- insert:
    - id: workdsh-process-sessions
      name: workdsh-provider-identity-enterprise/process-sessions
      config:
${identity}        bridgeUrl: ${quote(bridgeUrl)}
`;
  }
  return patch;
}
