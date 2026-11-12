# assets

把要替换的 SVG 放在这个目录，然后在 `../brand.config.json` 里把对应 `mark.asset` 写成文件名（例如 `"mark.svg"`）即可。

- 只接受 `.svg`，单文件不超过 256 KB；构建期会校验，缺文件或非 SVG 直接失败。
- 文件名不能带路径分隔符，避免越出本目录。
- `mark.asset` 为 `null` 时使用 `workdsh-ui` 的 `LogoMark`。
- SVG 自身请使用 `viewBox` 并省略固定的 `width` / `height`；渲染时会按配置的 `size` 缩放。
