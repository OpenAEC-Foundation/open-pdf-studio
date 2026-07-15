// Prevents the additional console window on Windows, DO NOT REMOVE!!
// Unconditional (also debug builds): the app must run fully in the
// background with only its own window. Dev logs stay visible when launched
// from a terminal (`tauri dev` pipes stdio); double-click runs log nothing,
// startup failures still land in the app-local startup diagnostics file.
#![windows_subsystem = "windows"]

use clap::Parser;

#[derive(Parser, Debug, Clone)]
#[command(name = "open-pdf-studio", version)]
struct Cli {
    /// Start an in-process MCP server on `--mcp-port` (default 9223). Off by default.
    /// Production builds refuse to start the server unless OPS_ENABLE_MCP=1.
    #[arg(long, default_value_t = false)]
    mcp_server: bool,

    /// Port for the MCP server (only used when --mcp-server is set).
    #[arg(long, default_value_t = 9223)]
    mcp_port: u16,
}

fn main() {
    // Tauri swallows unrecognized args (e.g. file-association launches), so we
    // try_parse rather than parse so unknown args don't abort startup.
    let args: Vec<String> = std::env::args().collect();
    let cli = Cli::try_parse_from(&args).unwrap_or(Cli {
        mcp_server: false,
        mcp_port: 9223,
    });

    app_lib::run(app_lib::StartupOpts {
        mcp_server: cli.mcp_server,
        mcp_port: cli.mcp_port,
    });
}
