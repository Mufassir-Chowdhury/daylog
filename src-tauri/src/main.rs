// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by Claude as an MCP server: relay to the running app, no window.
    if std::env::args().skip(1).any(|a| a == "--mcp") {
        std::process::exit(daylog_lib::mcp_bridge());
    }
    daylog_lib::run()
}
