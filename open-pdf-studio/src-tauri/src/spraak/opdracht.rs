//! Command lines for the OS speech engines (read aloud, #384).
//!
//! Pure functions, std only: which program, which arguments, what goes to
//! stdin and which environment variables. The text is never part of a shell
//! string: it goes through stdin (SAPI, say, espeak-ng) or as a single
//! argument after `--` (spd-say). A voice name for SAPI goes through an
//! environment variable, so nothing the document contains reaches the
//! PowerShell script text.

/// A speech engine available on this system.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Motor {
    /// Windows: System.Speech (SAPI) through PowerShell.
    Sapi,
    /// macOS: `say`.
    Say,
    /// Linux: speech-dispatcher's `spd-say`.
    SpdSay,
    /// Linux: `espeak-ng`.
    EspeakNg,
    /// Linux: classic `espeak`.
    Espeak,
}

impl Motor {
    pub fn naam(self) -> &'static str {
        match self {
            Motor::Sapi => "sapi",
            Motor::Say => "say",
            Motor::SpdSay => "spd-say",
            Motor::EspeakNg => "espeak-ng",
            Motor::Espeak => "espeak",
        }
    }

    pub fn programma(self) -> &'static str {
        match self {
            Motor::Sapi => "powershell",
            Motor::Say => "say",
            Motor::SpdSay => "spd-say",
            Motor::EspeakNg => "espeak-ng",
            Motor::Espeak => "espeak",
        }
    }
}

/// A process to start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Opdracht {
    pub programma: String,
    pub argumenten: Vec<String>,
    pub stdin: Option<String>,
    pub omgeving: Vec<(String, String)>,
}

/// Rate multiplier (1.0 = normal) clamped to 0.5..=2.0.
pub fn begrens_tempo(tempo: f64) -> f64 {
    if !tempo.is_finite() || tempo <= 0.0 {
        return 1.0;
    }
    tempo.clamp(0.5, 2.0)
}

/// SAPI rate -10..=10: 2x faster is +10, half speed is -10.
pub fn sapi_tempo(tempo: f64) -> i32 {
    (begrens_tempo(tempo).log2() * 10.0).round() as i32
}

/// Words per minute for say / espeak (175 is their normal rate).
pub fn woorden_per_minuut(tempo: f64) -> u32 {
    (175.0 * begrens_tempo(tempo)).round() as u32
}

/// spd-say rate -100..=100.
pub fn spd_tempo(tempo: f64) -> i32 {
    let t = begrens_tempo(tempo);
    let r = if t >= 1.0 { (t - 1.0) * 100.0 } else { (t - 1.0) * 200.0 };
    (r.round() as i32).clamp(-100, 100)
}

const SAPI_SPREEK: &str = "$ErrorActionPreference='Stop';\
Add-Type -AssemblyName System.Speech;\
$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;\
$s.Rate=[int]$env:OPS_TTS_RATE;\
if($env:OPS_TTS_VOICE){try{$s.SelectVoice($env:OPS_TTS_VOICE)}catch{}};\
$r=New-Object IO.StreamReader([Console]::OpenStandardInput(),[Text.Encoding]::UTF8);\
$t=$r.ReadToEnd();\
$s.Speak($t)";

const SAPI_STEMMEN: &str = "try{[Console]::OutputEncoding=[Text.Encoding]::UTF8}catch{};\
Add-Type -AssemblyName System.Speech;\
(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices()|\
Where-Object {$_.Enabled}|ForEach-Object {$_.VoiceInfo.Name}";

fn powershell(script: &str) -> Vec<String> {
    vec![
        "-NoProfile".into(),
        "-NonInteractive".into(),
        "-ExecutionPolicy".into(),
        "Bypass".into(),
        "-Command".into(),
        script.into(),
    ]
}

fn stem(stem: Option<&str>) -> Option<&str> {
    stem.map(str::trim).filter(|s| !s.is_empty() && !s.starts_with('-'))
}

/// The command that speaks `tekst` and exits when it is done.
pub fn spreek_opdracht(motor: Motor, tekst: &str, stemnaam: Option<&str>, tempo: f64) -> Opdracht {
    let stemnaam = stem(stemnaam);
    let programma = motor.programma().to_string();
    match motor {
        Motor::Sapi => {
            let mut omgeving = vec![("OPS_TTS_RATE".to_string(), sapi_tempo(tempo).to_string())];
            if let Some(v) = stemnaam {
                omgeving.push(("OPS_TTS_VOICE".to_string(), v.to_string()));
            }
            Opdracht { programma, argumenten: powershell(SAPI_SPREEK), stdin: Some(tekst.to_string()), omgeving }
        }
        Motor::Say => {
            let mut argumenten = vec!["-r".to_string(), woorden_per_minuut(tempo).to_string()];
            if let Some(v) = stemnaam {
                argumenten.push("-v".into());
                argumenten.push(v.into());
            }
            argumenten.push("-f".into());
            argumenten.push("-".into());
            Opdracht { programma, argumenten, stdin: Some(tekst.to_string()), omgeving: vec![] }
        }
        Motor::SpdSay => {
            let mut argumenten = vec!["-w".to_string(), "-r".to_string(), spd_tempo(tempo).to_string()];
            if let Some(v) = stemnaam {
                argumenten.push("-y".into());
                argumenten.push(v.into());
            }
            argumenten.push("--".into());
            argumenten.push(tekst.to_string());
            Opdracht { programma, argumenten, stdin: None, omgeving: vec![] }
        }
        Motor::EspeakNg | Motor::Espeak => {
            let mut argumenten = vec!["-b".to_string(), "1".to_string(), "-s".to_string(), woorden_per_minuut(tempo).to_string()];
            if let Some(v) = stemnaam {
                argumenten.push("-v".into());
                argumenten.push(v.into());
            }
            argumenten.push("--stdin".into());
            Opdracht { programma, argumenten, stdin: Some(tekst.to_string()), omgeving: vec![] }
        }
    }
}

/// The command that lists the voices of `motor`.
pub fn stemmen_opdracht(motor: Motor) -> Opdracht {
    let programma = motor.programma().to_string();
    let argumenten = match motor {
        Motor::Sapi => powershell(SAPI_STEMMEN),
        Motor::Say => vec!["-v".into(), "?".into()],
        Motor::SpdSay => vec!["-L".into()],
        Motor::EspeakNg | Motor::Espeak => vec!["--voices".into()],
    };
    Opdracht { programma, argumenten, stdin: None, omgeving: vec![] }
}

/// Voice names from the output of `stemmen_opdracht`.
pub fn lees_stemmen(motor: Motor, uitvoer: &str) -> Vec<String> {
    let mut stemmen: Vec<String> = Vec::new();
    for regel in uitvoer.lines() {
        let naam = match motor {
            Motor::Sapi => Some(regel.trim().to_string()),
            // "Alex                en_US    # Most people recognize me by my voice."
            Motor::Say => regel.split('#').next().and_then(|voor| {
                let voor = voor.trim_end();
                let mut delen: Vec<&str> = voor.split_whitespace().collect();
                if delen.len() < 2 {
                    return None;
                }
                delen.pop();
                Some(delen.join(" "))
            }),
            // "NAME   LANGUAGE   VARIANT" header, then one voice per line.
            Motor::SpdSay => {
                let eerste = regel.split_whitespace().next().unwrap_or("");
                if eerste.eq_ignore_ascii_case("NAME") { None } else { Some(eerste.to_string()) }
            }
            // "Pty Language Age/Gender VoiceName File Other Languages": -v takes the language.
            Motor::EspeakNg | Motor::Espeak => {
                let delen: Vec<&str> = regel.split_whitespace().collect();
                if delen.len() >= 2 && delen[0].chars().all(|c| c.is_ascii_digit()) { Some(delen[1].to_string()) } else { None }
            }
        };
        if let Some(n) = naam.filter(|n| !n.is_empty()) {
            if !stemmen.contains(&n) {
                stemmen.push(n);
            }
        }
    }
    stemmen
}

/// The engine to use, given the OS and a test for programs on PATH.
pub fn kies_motor(os: &str, bestaat: impl Fn(&str) -> bool) -> Option<Motor> {
    match os {
        "windows" => Some(Motor::Sapi),
        "macos" => Some(Motor::Say),
        _ => [Motor::SpdSay, Motor::EspeakNg, Motor::Espeak].into_iter().find(|m| bestaat(m.programma())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tempo_wordt_per_motor_omgerekend() {
        assert_eq!(sapi_tempo(1.0), 0);
        assert_eq!(sapi_tempo(2.0), 10);
        assert_eq!(sapi_tempo(0.5), -10);
        assert_eq!(sapi_tempo(9.0), 10);
        assert_eq!(woorden_per_minuut(1.0), 175);
        assert_eq!(woorden_per_minuut(1.5), 263);
        assert_eq!(spd_tempo(1.0), 0);
        assert_eq!(spd_tempo(2.0), 100);
        assert_eq!(spd_tempo(0.5), -100);
        assert_eq!(begrens_tempo(f64::NAN), 1.0);
    }

    #[test]
    fn tekst_gaat_nooit_door_een_shell() {
        let kwaad = "\"; Remove-Item C:\\ -Recurse; $(calc)";
        let o = spreek_opdracht(Motor::Sapi, kwaad, Some("Microsoft Zira Desktop"), 1.0);
        assert_eq!(o.programma, "powershell");
        assert!(o.argumenten.iter().all(|a| !a.contains("Remove-Item")));
        assert_eq!(o.stdin.as_deref(), Some(kwaad));
        assert!(o.omgeving.contains(&("OPS_TTS_VOICE".into(), "Microsoft Zira Desktop".into())));

        let s = spreek_opdracht(Motor::SpdSay, "-x text", None, 1.0);
        let pos = s.argumenten.iter().position(|a| a == "--").unwrap();
        assert_eq!(s.argumenten[pos + 1], "-x text");
        assert_eq!(s.argumenten.len(), pos + 2);

        let e = spreek_opdracht(Motor::EspeakNg, "hallo", Some("--evil"), 1.0);
        assert!(!e.argumenten.contains(&"--evil".to_string()), "a voice that looks like an option is dropped");
        assert_eq!(e.stdin.as_deref(), Some("hallo"));

        let m = spreek_opdracht(Motor::Say, "hi", Some("Alex"), 2.0);
        assert_eq!(m.argumenten, vec!["-r", "350", "-v", "Alex", "-f", "-"]);
    }

    #[test]
    fn stemmen_lezen() {
        let say = "Alex                en_US    # Most people recognize me by my voice.\nGood News           en_US    # Hello\n";
        assert_eq!(lees_stemmen(Motor::Say, say), vec!["Alex", "Good News"]);
        let spd = "NAME                 LANGUAGE        VARIANT\nnl                 nl              none\nen-us   en-US  none\n";
        assert_eq!(lees_stemmen(Motor::SpdSay, spd), vec!["nl", "en-us"]);
        let espeak = "Pty Language       Age/Gender VoiceName          File                 Other Languages\n 5  af              --/M      Afrikaans          gmw/af\n 5  nl              --/M      Dutch              gmw/nl\n";
        assert_eq!(lees_stemmen(Motor::EspeakNg, espeak), vec!["af", "nl"]);
        assert_eq!(lees_stemmen(Motor::Sapi, "Microsoft David Desktop\r\nMicrosoft Zira Desktop\r\n\r\n"), vec!["Microsoft David Desktop", "Microsoft Zira Desktop"]);
    }

    #[test]
    fn motorkeuze() {
        assert_eq!(kies_motor("windows", |_| false), Some(Motor::Sapi));
        assert_eq!(kies_motor("macos", |_| false), Some(Motor::Say));
        assert_eq!(kies_motor("linux", |p| p == "espeak-ng"), Some(Motor::EspeakNg));
        assert_eq!(kies_motor("linux", |p| p == "spd-say" || p == "espeak-ng"), Some(Motor::SpdSay));
        assert_eq!(kies_motor("linux", |_| false), None);
    }
}
