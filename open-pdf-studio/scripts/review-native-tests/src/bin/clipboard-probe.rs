// Test harness only: drive the production broker from independent processes.
#[allow(dead_code)]
#[path = "../../../../src-tauri/src/annotation_clipboard.rs"]
mod annotation_clipboard;
use std::io::{Read,Write};
fn main() {
    let args:Vec<_>=std::env::args().collect();
    if args[1]=="server" {
        let b=annotation_clipboard::Broker::start("t".repeat(64)).unwrap();
        println!("{}",b.address);std::io::stdout().flush().unwrap();loop{std::thread::park();}
    }
    let b=annotation_clipboard::Broker::inherited(&args[2],"t".repeat(64)).unwrap();
    let mut input=String::new();std::io::stdin().read_to_string(&mut input).unwrap();
    let request:serde_json::Value=serde_json::from_str(&input).unwrap();
    let candidate=request.get("candidate").filter(|v|!v.is_null()).cloned();
    let known=request["known"].as_str().map(str::to_owned);
    println!("{}",b.exchange(candidate,known).unwrap());
}
