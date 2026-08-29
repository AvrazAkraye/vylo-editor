//! MCP — talking to tool servers over stdio.
//!
//! ## The config is in the repository, which makes it untrusted
//!
//! `.vylo/mcp.json` lives in the project, so it arrives with the project. A
//! repository you cloned can name any command it likes, and a client that reads
//! that file and starts what it says is a way to run a stranger's code by
//! opening their folder. Claude Desktop keeps its config user-global for
//! exactly this reason.
//!
//! So **reading the config starts nothing**. `servers` parses and returns what
//! the file declares, including the exact command and arguments, and a server
//! only ever spawns from `start`, which the UI calls after a human has read
//! that command and enabled it. Enablement is remembered against a hash of the
//! command, so editing the config asks again rather than inheriting the
//! previous answer.
//!
//! ## And the tools themselves are third-party
//!
//! Once a server is running its tools are merged into the model's schema, but
//! every call goes through the same approval gate as `run_command`. An MCP tool
//! can do anything — write to a database, post to an API — and none of that is
//! visible from its name.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Long enough for `npx` to fetch a package on first run.
const HANDSHAKE: Duration = Duration::from_secs(30);
const CALL: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerSpec {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

impl ServerSpec {
    /// What the human is agreeing to. Enablement is stored against this, so a
    /// changed command is a new question rather than an inherited answer.
    pub fn fingerprint(&self) -> String {
        let mut line = self.command.clone();
        for a in &self.args {
            line.push(' ');
            line.push_str(a);
        }
        let mut keys: Vec<&String> = self.env.keys().collect();
        keys.sort();
        for k in keys {
            line.push_str(" env:");
            line.push_str(k);
        }
        line
    }
}

/// Parse the config. Deliberately returns specs and starts nothing.
pub fn parse_config(text: &str) -> Result<Vec<ServerSpec>, String> {
    let v: Value = serde_json::from_str(text).map_err(|e| format!("mcp.json is not valid JSON: {e}"))?;
    let map = v
        .get("mcpServers")
        .and_then(|m| m.as_object())
        .ok_or_else(|| "mcp.json has no \"mcpServers\" object".to_string())?;

    let mut out = Vec::new();
    for (name, entry) in map {
        let command = entry.get("command").and_then(|c| c.as_str()).unwrap_or("").to_string();
        if command.is_empty() {
            return Err(format!("server \"{name}\" has no command"));
        }
        let args = entry
            .get("args")
            .and_then(|a| a.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let env = entry
            .get("env")
            .and_then(|e| e.as_object())
            .map(|e| {
                e.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default();
        out.push(ServerSpec { name: name.clone(), command, args, env });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

struct Running {
    child: Child,
    stdin: ChildStdin,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, Sender<Value>>>>,
    /// The tail of stderr, so a failure can say what the server complained about.
    errors: Arc<Mutex<Vec<String>>>,
    pub tools: Vec<Value>,
}

#[derive(Default)]
pub struct Servers(pub Mutex<HashMap<String, Running>>);

fn rpc(r: &mut Running, method: &str, params: Value, wait: Duration) -> Result<Value, String> {
    let id = r.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = channel();
    r.pending.lock().map_err(|_| "mcp state is unusable")?.insert(id, tx);

    let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    writeln!(r.stdin, "{msg}").map_err(|e| format!("could not write to the server: {e}"))?;
    r.stdin.flush().map_err(|e| format!("could not write to the server: {e}"))?;

    match rx.recv_timeout(wait) {
        Ok(v) => {
            if let Some(err) = v.get("error") {
                let m = err.get("message").and_then(|m| m.as_str()).unwrap_or("unknown error");
                return Err(format!("{method}: {m}"));
            }
            Ok(v.get("result").cloned().unwrap_or(Value::Null))
        }
        Err(_) => {
            r.pending.lock().ok().and_then(|mut p| p.remove(&id));
            let tail = r.errors.lock().ok().map(|e| e.join("\n")).unwrap_or_default();
            Err(if tail.trim().is_empty() {
                format!("the server did not answer {method} within {}s", wait.as_secs())
            } else {
                format!("the server did not answer {method}; it printed:\n{tail}")
            })
        }
    }
}

fn notify(r: &mut Running, method: &str, params: Value) {
    let msg = json!({ "jsonrpc": "2.0", "method": method, "params": params });
    let _ = writeln!(r.stdin, "{msg}");
    let _ = r.stdin.flush();
}

/// Spawn a server, shake hands, and ask what it can do.
///
/// Called only after a human has read the command and enabled it.
pub fn start(state: &Servers, spec: &ServerSpec, cwd: &str) -> Result<Vec<Value>, String> {
    stop(state, &spec.name);

    let mut cmd = Command::new(&spec.command);
    cmd.args(&spec.args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start \"{}\": {e}", spec.command))?;

    let stdin = child.stdin.take().ok_or("no stdin on the server")?;
    let stdout = child.stdout.take().ok_or("no stdout on the server")?;
    let stderr = child.stderr.take();

    let pending: Arc<Mutex<HashMap<u64, Sender<Value>>>> = Arc::new(Mutex::new(HashMap::new()));
    let errors: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

    // Both pipes are drained on their own threads. A server that fills its
    // stderr buffer while nobody reads it blocks on write and never answers —
    // the same deadlock `run_command` hit, for the same reason.
    {
        let pending = Arc::clone(&pending);
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                let Some(id) = v.get("id").and_then(Value::as_u64) else { continue };
                let tx = pending.lock().ok().and_then(|mut p| p.remove(&id));
                if let Some(tx) = tx {
                    let _ = tx.send(v);
                }
            }
        });
    }
    if let Some(stderr) = stderr {
        let errors = Arc::clone(&errors);
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut e) = errors.lock() {
                    if e.len() >= 40 {
                        e.remove(0);
                    }
                    e.push(line);
                }
            }
        });
    }

    let mut running = Running {
        child,
        stdin,
        next_id: AtomicU64::new(1),
        pending,
        errors,
        tools: Vec::new(),
    };

    let init = rpc(
        &mut running,
        "initialize",
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "Vylo Editor", "version": env!("CARGO_PKG_VERSION") }
        }),
        HANDSHAKE,
    );
    if let Err(e) = init {
        let _ = running.child.kill();
        return Err(e);
    }
    notify(&mut running, "notifications/initialized", json!({}));

    let listed = match rpc(&mut running, "tools/list", json!({}), HANDSHAKE) {
        Ok(v) => v,
        Err(e) => {
            let _ = running.child.kill();
            return Err(e);
        }
    };
    let tools: Vec<Value> = listed
        .get("tools")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    running.tools = tools.clone();

    state
        .0
        .lock()
        .map_err(|_| "mcp state is unusable".to_string())?
        .insert(spec.name.clone(), running);
    Ok(tools)
}

pub fn call(state: &Servers, server: &str, tool: &str, args: Value) -> Result<String, String> {
    let mut map = state.0.lock().map_err(|_| "mcp state is unusable".to_string())?;
    let r = map
        .get_mut(server)
        .ok_or_else(|| format!("\"{server}\" is not running"))?;
    let out = rpc(r, "tools/call", json!({ "name": tool, "arguments": args }), CALL)?;
    Ok(flatten(&out))
}

/// MCP returns content blocks; the agent wants text.
pub fn flatten(result: &Value) -> String {
    let Some(items) = result.get("content").and_then(|c| c.as_array()) else {
        return result.to_string();
    };
    let mut out = Vec::new();
    for item in items {
        match item.get("type").and_then(Value::as_str) {
            Some("text") => out.push(item.get("text").and_then(Value::as_str).unwrap_or("").to_string()),
            Some("resource") => out.push(
                item.get("resource")
                    .and_then(|r| r.get("text"))
                    .and_then(Value::as_str)
                    .unwrap_or("[resource]")
                    .to_string(),
            ),
            // An image from a tool is not something the loop can forward, and
            // saying so is better than an empty result.
            Some(kind) => out.push(format!("[{kind} content, not shown]")),
            None => {}
        }
    }
    out.join("\n")
}

pub fn stop(state: &Servers, name: &str) {
    if let Ok(mut map) = state.0.lock() {
        if let Some(mut r) = map.remove(name) {
            let _ = r.child.kill();
            let _ = r.child.wait();
        }
    }
}

pub fn stop_all(state: &Servers) {
    if let Ok(mut map) = state.0.lock() {
        for (_, mut r) in map.drain() {
            let _ = r.child.kill();
            let _ = r.child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_claude_desktop_config_parses() {
        let s = parse_config(
            r#"{"mcpServers":{
                "postgres":{"command":"npx","args":["-y","server-postgres","postgres://x"]},
                "files":{"command":"/usr/local/bin/mcp-files","env":{"ROOT":"/tmp"}}
            }}"#,
        )
        .unwrap();
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].name, "files", "sorted, so the list does not reshuffle");
        assert_eq!(s[1].args, vec!["-y", "server-postgres", "postgres://x"]);
        assert_eq!(s[0].env.get("ROOT").map(String::as_str), Some("/tmp"));
    }

    #[test]
    fn a_bad_config_says_what_is_wrong() {
        assert!(parse_config("not json").unwrap_err().contains("valid JSON"));
        assert!(parse_config("{}").unwrap_err().contains("mcpServers"));
        assert!(parse_config(r#"{"mcpServers":{"x":{}}}"#).unwrap_err().contains("no command"));
    }

    /// The fingerprint is what an approval is stored against, so it has to move
    /// whenever the thing being approved does.
    #[test]
    fn the_fingerprint_tracks_what_would_actually_run() {
        let base = parse_config(r#"{"mcpServers":{"a":{"command":"npx","args":["-y","pkg"]}}}"#).unwrap();
        let same = parse_config(r#"{"mcpServers":{"a":{"command":"npx","args":["-y","pkg"]}}}"#).unwrap();
        assert_eq!(base[0].fingerprint(), same[0].fingerprint());

        for changed in [
            r#"{"mcpServers":{"a":{"command":"npx","args":["-y","other"]}}}"#,
            r#"{"mcpServers":{"a":{"command":"sh","args":["-y","pkg"]}}}"#,
            r#"{"mcpServers":{"a":{"command":"npx","args":["-y","pkg"],"env":{"TOKEN":"x"}}}}"#,
        ] {
            let other = parse_config(changed).unwrap();
            assert_ne!(
                base[0].fingerprint(),
                other[0].fingerprint(),
                "a changed command must ask again: {changed}",
            );
        }
    }

    #[test]
    fn content_blocks_flatten_to_text() {
        let v: Value = serde_json::from_str(
            r#"{"content":[{"type":"text","text":"one"},{"type":"text","text":"two"}]}"#,
        )
        .unwrap();
        assert_eq!(flatten(&v), "one\ntwo");

        let img: Value = serde_json::from_str(r#"{"content":[{"type":"image","data":"..."}]}"#).unwrap();
        assert!(flatten(&img).contains("not shown"), "say so rather than returning nothing");

        let odd: Value = serde_json::from_str(r#"{"whatever":1}"#).unwrap();
        assert!(flatten(&odd).contains("whatever"), "an unknown shape is passed through");
    }
}
