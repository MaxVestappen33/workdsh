import{createRequire}from'node:module';import{pathToFileURL}from'node:url';
const require=createRequire(new URL('../../package.json',import.meta.url));
// Match production: the compiler and official tool API are runtime dependencies,
// not copies bundled into a data: test module (TypeScript uses Node fs).
export const preflightExternals={name:'published-preflight-dependencies',setup(builder){builder.onResolve({filter:/^(?:typescript|@deepseek-ai\/dsh-tools)$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}};
