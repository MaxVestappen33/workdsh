/** Only translate known bounded diagnostics; never display candidate logs/code. */
export function packageCheckMessage(code: unknown) {
  if (code === 'workbench/native-installation-not-present') return '尚未发现此应用的安装文件，可以检查候选版本后安装。';
  if (code === 'workbench/native-installation-version-different') return '本机安装的是其他版本，请重新检查候选并核对更新范围。';
  if (code === 'workbench/installed-file-missing') return '本机安装文件不完整。已停止自动恢复，请返回开发对话检查安装错误，暂勿重复安装。';
  if (code === 'workbench/installed-file-mismatch' || code === 'workbench/package-hash-mismatch' || code === 'workbench/installation-changed') return '本机文件与候选版本不一致。已停止自动恢复，不会重复安装；请返回开发对话检查文件并重新构建。';
  if (code === 'workbench/native-installation-unconfirmed') return '安装结果暂时无法核对，可能是宿主连接中断。恢复连接后重新核对，暂勿重复安装。';
  if (code === 'workbench/development-revision-conflict' || code === 'workbench/requirements-revision-conflict') return '需求或开发记录已经变化，请返回重新读取候选版本。';
  if (code === 'workbench/development-access-denied' || code === 'workbench/development-owner-mismatch') return '当前账号或会话无权核对这份开发记录，请确认所属账号和会话。';
  if (code === 'workbench/native-installation-candidate-missing') return '尚未找到与此版本和摘要匹配的开发产物，请返回开发对话重新检查打包结果。';
  if (code === 'workbench/package-macos-metadata' || code === 'workbench/package-unsupported-entry') return '归档含 macOS 附加文件或不支持的扩展记录。请使用 npm pack 重新打包，不要用系统 tar 代替；npm 缓存无权限时改用项目目录内的缓存。';
  if (code === 'workbench/tool-optional-required-false') return '工具参数格式错误：可选参数请省略 required，不能填写 required: false。修复并重新打包后再检查。';
  if (code === 'workbench/tool-schema-invalid') return '工具参数未通过当前官方接口校验。请在开发对话中修正工具定义并重新打包。';
  if (code === 'workbench/package-kernel-version-mismatch' || code === 'workbench/package-cordis-version-mismatch') return '运行时依赖版本不匹配，请使用当前宿主支持的官方版本重新构建。';
  if (code === 'workbench/package-missing-export' || code === 'workbench/package-missing-entry') return '插件包缺少入口或构建文件，请完成构建后重新打包。';
  return '插件包检查未通过，请回到开发对话修正后重试。';
}
