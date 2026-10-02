# Desktop carrier integration

Desktop source and packaging belong to the independent dsh-ssh-desktop repository. This Web workspace does not own a copied Electron carrier, Host or Client implementation.

The Desktop carrier uses its pinned official upstream runtime and explicitly selected WorkDSH Profile packages. Its alignment, checks and packaged-runtime acceptance are separate from Web source checks. The default owned feature boundary is recorded in [EXTERNAL-PLUGINS](../../docs/EXTERNAL-PLUGINS.md); the enterprise account package ships with the immutable runtime and activates only after enterprise login; collaboration and notification plugins remain external.
