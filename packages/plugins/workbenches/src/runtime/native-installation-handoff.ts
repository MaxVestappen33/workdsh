/** A byte-verification receipt is deliberately silent about runtime activation.
 * Exact public operations below are conditional guidance, never authorization. */
export function nativeWorkbenchInstallationHandoff(packageName:string){
 return {
  activation:{status:'not-checked' as const,reason:'verification-only' as const,
   explanation:'activationVerified:false 只表示本工具未核验启用状态，不表示应用已停用或启用失败。安装字节已核对并登记，不要因此重复安装。'},
  clientPage:{status:'not-checked' as const,requiredSurface:'authenticated-host-application' as const},
  nextStep:{
   ifActivationAuthorized:{
    inspect:{tool:'plugin_manager',arguments:{action:'list_bundles',offset:0,limit:100}},
    matchPackageName:packageName,
    enable:{tool:'plugin_manager',arguments:{action:'set_bundle',target:packageName,enabled:true}},
    instruction:'仅在用户已授权启用或打开试用时执行：先按 nextOffset 分页找到同名 bundle，核对版本和 error；再按实际包名 set_bundle。读取 application 与 nextStep，restart-required 时如实报告并保留其他任务。不要猜 entryId、include: 前缀或改用 set_plugin；不要重复 install_bundle。',
   },
   ifActivationNotAuthorized:'保留已安装、已登记状态，由用户在工作台列表启用并打开。',
   pageAcceptance:'启用后，在当前已认证的宿主应用页面打开工作台：Desktop 使用正在运行的 WebView，Web 使用当前已登录应用页面。操作已保存验收样例并重开核对数据；未操作的页面和业务仍标为未验收。',
   authenticationBoundary:'独立任务浏览器不自动共享宿主应用登录态。遇到 401 时停止该验收路径，记录页面未验收并返回当前已认证宿主页面；不得探查、复制 token、cookie、凭据或加认证请求头绕过。',
  },
 };
}
