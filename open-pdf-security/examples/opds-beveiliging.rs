//! Opdrachtregel voor de proeven met andere lezers
//! (open-pdf-studio/js/pdf/document-beveiliging-interop.test.mjs):
//!
//!   opds-beveiliging protect <in> <uit> <openwachtwoord> <rechtenwachtwoord> <P>
//!   opds-beveiliging rewrap  <versleuteld origineel> <wachtwoord> <platte bewerking> <uit>
//!   opds-beveiliging decrypt <in> <wachtwoord> <uit>
//!   opds-beveiliging info    <in>
//!
//! Een fout gaat als vaste code naar stderr, met afsluitcode 2.

use open_pdf_security::{beveilig_pdf, lees_info, ontsleutel, versleutel, Beveiliging, Rechten};

fn lees(pad: &str) -> Vec<u8> {
    std::fs::read(pad).unwrap_or_else(|e| stop(&format!("READ_FAILED: {pad}: {e}")))
}

fn schrijf(pad: &str, bytes: &[u8]) {
    std::fs::write(pad, bytes).unwrap_or_else(|e| stop(&format!("WRITE_FAILED: {pad}: {e}")));
}

fn stop(code: &str) -> ! {
    eprintln!("{code}");
    std::process::exit(2);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let a = |i: usize| args.get(i).map(String::as_str).unwrap_or_else(|| stop("USAGE"));
    match a(0) {
        "protect" => {
            let p: i32 = a(5).parse().unwrap_or_else(|_| stop("USAGE: P is a number"));
            let uit = beveilig_pdf(&lees(a(1)), a(3), a(4), &Rechten::uit_bits(p)).unwrap_or_else(|f| stop(&f.code()));
            schrijf(a(2), &uit);
        }
        "rewrap" => {
            let b = Beveiliging::uit_bestand(&lees(a(1)), a(2)).unwrap_or_else(|f| stop(&f.code()));
            let uit = versleutel(&lees(a(3)), &b).unwrap_or_else(|f| stop(&f.code()));
            schrijf(a(4), &uit);
        }
        "decrypt" => {
            let uit = ontsleutel(&lees(a(1)), a(2)).unwrap_or_else(|f| stop(&f.code()));
            schrijf(a(3), &uit);
        }
        "info" => match lees_info(&lees(a(1))).unwrap_or_else(|f| stop(&f.code())) {
            None => println!("{{\"encrypted\":false}}"),
            Some(i) => println!(
                "{{\"encrypted\":true,\"methode\":\"{}\",\"v\":{},\"r\":{},\"lengte\":{},\"p\":{}}}",
                i.methode, i.v, i.r, i.lengte, i.p
            ),
        },
        _ => stop("USAGE"),
    }
}
