use zed_extension_api::{self as zed, Command, LanguageServerId, Result, Worktree};

struct ColorSyntaxExtension;

impl zed::Extension for ColorSyntaxExtension {
    fn new() -> Self {
        ColorSyntaxExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        _worktree: &Worktree,
    ) -> Result<Command> {
        // The WASI working directory is the extension's installed directory,
        // so resolve the bundled server script to an absolute path.
        let server_path = std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join("server.js");

        Ok(Command {
            command: zed::node_binary_path()?,
            args: vec![
                server_path.to_string_lossy().into_owned(),
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }
}

zed::register_extension!(ColorSyntaxExtension);
