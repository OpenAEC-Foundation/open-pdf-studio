//! CCITT Groep 4-encoder (ITU-T T.6) voor één-bit beelden (#902).
//!
//! Regel voor regel dezelfde codering als `js/pdf/ccitt-g4.js`: zuiver
//! tweedimensionaal (pass-, horizontaal- en verticaalmodus), denkbeeldige
//! witte eerste referentieregel, geen EOL's per regel, geen byte-uitlijning,
//! afgesloten met EOFB (twee EOL's). De uitvoer is byte-gelijk aan de
//! JS-encoder; de pariteitstest in `lib.rs` en
//! `scripts/bench-rust/09-monochrome.mjs` bewaken dat.
//!
//! Invoer zijn gepakte samples zoals in een PDF-beeldstream: elke rij begint
//! op een byte, meest significante bit eerst; opvulbits achter de laatste
//! kolom tellen niet mee. `black_is1`: true = bit 1 is zwart.

// Codetabellen als (code, lengte). Index = runlengte (0..63) voor de
// eindcodes, (runlengte / 64) - 1 voor de opbouwcodes.
const WHITE_TERM: [(u32, u32); 64] = [
    (0x35, 8), (0x07, 6), (0x07, 4), (0x08, 4), (0x0b, 4), (0x0c, 4), (0x0e, 4), (0x0f, 4),
    (0x13, 5), (0x14, 5), (0x07, 5), (0x08, 5), (0x08, 6), (0x03, 6), (0x34, 6), (0x35, 6),
    (0x2a, 6), (0x2b, 6), (0x27, 7), (0x0c, 7), (0x08, 7), (0x17, 7), (0x03, 7), (0x04, 7),
    (0x28, 7), (0x2b, 7), (0x13, 7), (0x24, 7), (0x18, 7), (0x02, 8), (0x03, 8), (0x1a, 8),
    (0x1b, 8), (0x12, 8), (0x13, 8), (0x14, 8), (0x15, 8), (0x16, 8), (0x17, 8), (0x28, 8),
    (0x29, 8), (0x2a, 8), (0x2b, 8), (0x2c, 8), (0x2d, 8), (0x04, 8), (0x05, 8), (0x0a, 8),
    (0x0b, 8), (0x52, 8), (0x53, 8), (0x54, 8), (0x55, 8), (0x24, 8), (0x25, 8), (0x58, 8),
    (0x59, 8), (0x5a, 8), (0x5b, 8), (0x4a, 8), (0x4b, 8), (0x32, 8), (0x33, 8), (0x34, 8),
];
const WHITE_MAKEUP: [(u32, u32); 27] = [ // 64 .. 1728
    (0x1b, 5), (0x12, 5), (0x17, 6), (0x37, 7), (0x36, 8), (0x37, 8), (0x64, 8), (0x65, 8),
    (0x68, 8), (0x67, 8), (0xcc, 9), (0xcd, 9), (0xd2, 9), (0xd3, 9), (0xd4, 9), (0xd5, 9),
    (0xd6, 9), (0xd7, 9), (0xd8, 9), (0xd9, 9), (0xda, 9), (0xdb, 9), (0x98, 9), (0x99, 9),
    (0x9a, 9), (0x18, 6), (0x9b, 9),
];
const BLACK_TERM: [(u32, u32); 64] = [
    (0x37, 10), (0x02, 3), (0x03, 2), (0x02, 2), (0x03, 3), (0x03, 4), (0x02, 4), (0x03, 5),
    (0x05, 6), (0x04, 6), (0x04, 7), (0x05, 7), (0x07, 7), (0x04, 8), (0x07, 8), (0x18, 9),
    (0x17, 10), (0x18, 10), (0x08, 10), (0x67, 11), (0x68, 11), (0x6c, 11), (0x37, 11), (0x28, 11),
    (0x17, 11), (0x18, 11), (0xca, 12), (0xcb, 12), (0xcc, 12), (0xcd, 12), (0x68, 12), (0x69, 12),
    (0x6a, 12), (0x6b, 12), (0xd2, 12), (0xd3, 12), (0xd4, 12), (0xd5, 12), (0xd6, 12), (0xd7, 12),
    (0x6c, 12), (0x6d, 12), (0xda, 12), (0xdb, 12), (0x54, 12), (0x55, 12), (0x56, 12), (0x57, 12),
    (0x64, 12), (0x65, 12), (0x52, 12), (0x53, 12), (0x24, 12), (0x37, 12), (0x38, 12), (0x27, 12),
    (0x28, 12), (0x58, 12), (0x59, 12), (0x2b, 12), (0x2c, 12), (0x5a, 12), (0x66, 12), (0x67, 12),
];
const BLACK_MAKEUP: [(u32, u32); 27] = [ // 64 .. 1728
    (0x0f, 10), (0xc8, 12), (0xc9, 12), (0x5b, 12), (0x33, 12), (0x34, 12), (0x35, 12), (0x6c, 13),
    (0x6d, 13), (0x4a, 13), (0x4b, 13), (0x4c, 13), (0x4d, 13), (0x72, 13), (0x73, 13), (0x74, 13),
    (0x75, 13), (0x76, 13), (0x77, 13), (0x52, 13), (0x53, 13), (0x54, 13), (0x55, 13), (0x5a, 13),
    (0x5b, 13), (0x64, 13), (0x65, 13),
];
const EXTENDED_MAKEUP: [(u32, u32); 13] = [ // 1792 .. 2560, gedeeld door wit en zwart
    (0x08, 11), (0x0c, 11), (0x0d, 11), (0x12, 12), (0x13, 12), (0x14, 12), (0x15, 12),
    (0x16, 12), (0x17, 12), (0x1c, 12), (0x1d, 12), (0x1e, 12), (0x1f, 12),
];
const PASS: (u32, u32) = (0x1, 4);
const HORIZONTAL: (u32, u32) = (0x1, 3);
// Verticaalmodus, index = (a1 - b1) + 3: VL3 VL2 VL1 V0 VR1 VR2 VR3.
const VERTICAL: [(u32, u32); 7] = [(0x02, 7), (0x02, 6), (0x02, 3), (0x1, 1), (0x03, 3), (0x03, 6), (0x03, 7)];
const EOL: (u32, u32) = (0x001, 12);
const SENTINELS: usize = 4;

/// Waarom er geen G4-uitvoer is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum G4Error {
    /// De uitvoer zou groter worden dan `max_bytes`; de aanroeper valt terug.
    OutputLimit,
    /// Ongeldige afmetingen of te weinig samplebytes.
    InvalidArguments,
}

struct BitWriter {
    max_bytes: usize,
    bytes: Vec<u8>,
    acc: u32, // nog niet geschreven bits, rechts uitgelijnd
    bits: u32,
}

impl BitWriter {
    fn new(max_bytes: usize) -> Self {
        BitWriter { max_bytes, bytes: Vec::with_capacity(max_bytes.min(4096)), acc: 0, bits: 0 }
    }
    #[inline]
    fn put(&mut self, (code, length): (u32, u32)) -> Result<(), G4Error> {
        self.acc = (self.acc << length) | code;
        self.bits += length;
        while self.bits >= 8 {
            self.bits -= 8;
            self.byte(((self.acc >> self.bits) & 0xff) as u8)?;
        }
        self.acc &= (1u32 << self.bits) - 1;
        Ok(())
    }
    #[inline]
    fn byte(&mut self, value: u8) -> Result<(), G4Error> {
        if self.bytes.len() >= self.max_bytes {
            return Err(G4Error::OutputLimit);
        }
        self.bytes.push(value);
        Ok(())
    }
    fn finish(mut self) -> Result<Vec<u8>, G4Error> {
        if self.bits > 0 {
            let last = ((self.acc << (8 - self.bits)) & 0xff) as u8;
            self.byte(last)?;
        }
        Ok(self.bytes)
    }
}

fn put_run(w: &mut BitWriter, mut run: i32, black: bool) -> Result<(), G4Error> {
    let makeup = if black { &BLACK_MAKEUP } else { &WHITE_MAKEUP };
    while run >= 2624 {
        w.put(EXTENDED_MAKEUP[12])?;
        run -= 2560;
    }
    if run >= 64 {
        let m = run & !63;
        w.put(if m <= 1728 { makeup[(m / 64 - 1) as usize] } else { EXTENDED_MAKEUP[((m - 1792) / 64) as usize] })?;
        run -= m;
    }
    w.put(if black { BLACK_TERM[run as usize] } else { WHITE_TERM[run as usize] })
}

// Kleurwisselingen van één rij: oplopende kolommen waar de kleur omslaat,
// beginnend vanaf denkbeeldig wit. Daarna SENTINELS keer `width`.
fn changes_of(row: &[u8], width: usize, invert: u8, out: &mut [i32]) {
    let mut n = 0usize;
    let mut color = 0u8;
    let full = width >> 3;
    for (i, &raw) in row[..full].iter().enumerate() {
        let v = raw ^ invert;
        // Bit b van `t` staat aan waar bit b van v verschilt van zijn
        // linkerbuur (voor bit 0: de huidige kleur). Zelfde wissels als bit
        // voor bit aflopen, maar alleen de wissels zelf kosten werk.
        let mut t = v ^ ((v >> 1) | (color << 7));
        while t != 0 {
            let b = t.leading_zeros() as usize;
            out[n] = ((i << 3) + b) as i32;
            n += 1;
            t &= !(0x80u8 >> b);
        }
        color = v & 1;
    }
    for x in (full << 3)..width {
        let bit = ((row[x >> 3] ^ invert) >> (7 - (x & 7))) & 1;
        if bit != color {
            out[n] = x as i32;
            n += 1;
            color = bit;
        }
    }
    for s in 0..SENTINELS {
        out[n + s] = width as i32;
    }
}

// Eén coderingsregel tegen de referentieregel (T.6, 2D-codering).
fn encode_line(w: &mut BitWriter, cur: &[i32], refl: &[i32], width: i32) -> Result<(), G4Error> {
    let mut a0: i32 = -1;
    let mut color: usize = 0;
    let mut ia = 0usize;
    let mut ib = 0usize;
    loop {
        while cur[ia] <= a0 {
            ia += 1;
        }
        let a1 = cur[ia];
        // b1: eerste wissel op de referentieregel rechts van a0 met de kleur
        // tegengesteld aan die van a0; eerst terug, dan vooruit zoeken.
        while ib > 0 && refl[ib - 1] > a0 {
            ib -= 1;
        }
        while refl[ib] <= a0 || (ib & 1) != color {
            ib += 1;
        }
        let b1 = refl[ib];
        let b2 = refl[ib + 1];
        if b2 < a1 {
            w.put(PASS)?;
            a0 = b2;
        } else if (-3..=3).contains(&(a1 - b1)) {
            w.put(VERTICAL[(a1 - b1 + 3) as usize])?;
            a0 = a1;
            color ^= 1;
        } else {
            let a2 = cur[ia + 1];
            w.put(HORIZONTAL)?;
            put_run(w, a1 - a0.max(0), color == 1)?;
            put_run(w, a2 - a1, color == 0)?;
            a0 = a2;
        }
        if a0 >= width {
            return Ok(());
        }
    }
}

/// Codeert gepakte één-bit samples als CCITT G4. `max_bytes` (None =
/// onbegrensd, zoals `Infinity` in JS) geeft `OutputLimit` zodra de uitvoer
/// groter zou worden.
pub fn encode_ccitt_g4(samples: &[u8], width: usize, height: usize, black_is1: bool, max_bytes: Option<usize>) -> Result<Vec<u8>, G4Error> {
    if width < 1 || height < 1 || width > i32::MAX as usize - 8 {
        return Err(G4Error::InvalidArguments);
    }
    let stride = width.div_ceil(8);
    if samples.len() < stride.checked_mul(height).ok_or(G4Error::InvalidArguments)? {
        return Err(G4Error::InvalidArguments);
    }
    let invert: u8 = if black_is1 { 0 } else { 0xff }; // intern is 1 altijd zwart
    let mut w = BitWriter::new(max_bytes.map(|m| m.max(1)).unwrap_or((1usize << 31) - 1));
    let mut refl = vec![0i32; width + SENTINELS + 1];
    let mut cur = vec![0i32; width + SENTINELS + 1];
    refl[..SENTINELS].fill(width as i32); // denkbeeldige witte eerste referentieregel
    for y in 0..height {
        changes_of(&samples[y * stride..(y + 1) * stride], width, invert, &mut cur);
        encode_line(&mut w, &cur, &refl, width as i32)?;
        std::mem::swap(&mut refl, &mut cur);
    }
    w.put(EOL)?;
    w.put(EOL)?;
    w.finish()
}
