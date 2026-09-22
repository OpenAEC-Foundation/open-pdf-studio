//! Extra papierformaten van de virtuele printer "Open PDF Printer", en de
//! PowerShell-scripts die de printer en die formaten installeren of weghalen.
//!
//! EÉN tabel (`FORMULIEREN`) is de bron voor alles:
//! - `print_instelling::Papier` haalt er de maten van A1, A0 en de verlengde
//!   vellen (A3L, A2L, A1L, A0L) uit voor het eigen printpad van de app;
//! - de scripts hieronder zetten dezelfde maten als formulier op de
//!   printserver (winspool `AddFormW`), zodat ándere programma's ze in hun
//!   printdialoog kunnen kiezen bij elke printer waarvan de driver
//!   formulieren van de printserver aanneemt.
//!
//! Een verlengd vel is het basisvel plus één A4-breedte (210 mm) in de
//! lengte; het vouwt terug naar A4.
//!
//! Grens van de ingebouwde pdf-driver ("Microsoft Print to PDF", gemeten op
//! Windows 11 build 26200): zijn papierlijst ligt vast. Zijn
//! PrintDeviceCapabilities kennen geen eigen papiermaat, en een eigen maat in
//! de DEVMODE negeert hij. A1 en A0 biedt hij zelf aan ("ISOA1", "ISOA0");
//! de verlengde vellen kan hij niet maken. Of hij een formulier van de
//! printserver toch in zijn lijst opneemt is alleen met beheerdersrechten
//! vast te stellen: `scripts/open-pdf-printer-forms.ps1` laat het zien. Voor
//! plotters en andere printers met eigen papiermaten werken de formulieren
//! wel; het printpad van de app valt waar een vel niet kan terug op het
//! papier van de printer en meldt dat in de printdialoog.
//!
//! De scripts draaien met beheerdersrechten op twee plekken: in het
//! installatieprogramma (`nsis/hooks.nsh` levert `nsis/install-printer.ps1`
//! en `nsis/uninstall-printer.ps1` mee) en in de app zelf
//! (`install_virtual_printer` / `remove_virtual_printer`). De bestanden in
//! `nsis/` en `scripts/` zijn de uitvoer van deze module; een test bewaakt dat
//! ze gelijk blijven. Opnieuw schrijven na een wijziging hier:
//! `OPDS_SCHRIJF_SCRIPTS=1` zetten en de test
//! `print_formulieren::tests::scriptbestanden_zijn_de_uitvoer_van_deze_module`
//! draaien.
//!
//! Alleen tekst: deze module roept zelf niets van Windows aan en is op elk
//! platform te testen.

#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

/// Naam van de virtuele printer.
pub const PRINTERNAAM: &str = "Open PDF Printer";
/// Naam die oudere versies gebruikten; wordt bij installatie opgeruimd.
pub const OUDE_PRINTERNAAM: &str = "Open PDF Studio";
/// De ingebouwde pdf-driver van Windows. Alleen printers met deze driver zijn
/// van ons: een eigen printer van de gebruiker met toevallig dezelfde naam
/// blijft altijd staan.
pub const DRIVERNAAM: &str = "Microsoft Print to PDF";
/// Poort die bij elke afdruk het venster Opslaan als toont.
pub const POORT_DIALOOG: &str = "PORTPROMPT:";
/// Registersleutel (HKLM, 64-bits weergave) waarin staat welke formulieren
/// wíj hebben toegevoegd. Alleen die halen we later weer weg.
pub const REGISTERSLEUTEL: &str = "SOFTWARE\\OpenPDFPrinter\\Forms";

/// Een papierformaat dat de app kent maar waarvoor Windows geen vaste
/// `DMPAPER_*`-code heeft.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Formulier {
    /// Sleutel in de Pagina-instelling en de Printdialoog ("a3l").
    pub sleutel: &'static str,
    /// Naam van het formulier op de printserver ("A3L").
    pub naam: &'static str,
    /// Vel staand: korte zijde in mm.
    pub breedte_mm: u32,
    /// Vel staand: lange zijde in mm.
    pub hoogte_mm: u32,
    /// Standaardvel (A1, A0) dat Windows of de driver vaak zelf al levert,
    /// soms onder een andere naam ("ISOA1"). Alleen toevoegen als er geen
    /// formulier met deze naam is én de driver deze maat nog niet aanbiedt.
    pub standaardvel: bool,
}

impl Formulier {
    /// Maat in duizendsten van een millimeter, de eenheid van `FORM_INFO_1`.
    pub fn maat_duizendste_mm(&self) -> (u32, u32) {
        (self.breedte_mm * 1000, self.hoogte_mm * 1000)
    }

    /// Maat in tienden van een millimeter, de eenheid van `dmPaperWidth` /
    /// `dmPaperLength` en van `DC_MAXEXTENT`.
    pub fn maat_tiende_mm(&self) -> (i32, i32) {
        (self.breedte_mm as i32 * 10, self.hoogte_mm as i32 * 10)
    }

    /// Past dit vel binnen de grootste eigen maat van een driver
    /// (`DC_MAXEXTENT`, in 0,1 mm)? Onbekende grens (`None`) telt als passend:
    /// dan beslist de driver zelf.
    pub fn past_binnen(&self, max_tiende_mm: Option<(i32, i32)>) -> bool {
        match max_tiende_mm {
            Some((max_breedte, max_lengte)) => {
                let (b, l) = self.maat_tiende_mm();
                b <= max_breedte && l <= max_lengte
            }
            None => true,
        }
    }
}

/// Breedte van een A4 in mm: zoveel langer is een verlengd vel.
pub const VERLENGING_MM: u32 = 210;

/// De extra formaten. Volgorde = volgorde van toevoegen.
pub const FORMULIEREN: [Formulier; 6] = [
    Formulier { sleutel: "a1", naam: "A1", breedte_mm: 594, hoogte_mm: 841, standaardvel: true },
    Formulier { sleutel: "a0", naam: "A0", breedte_mm: 841, hoogte_mm: 1189, standaardvel: true },
    Formulier { sleutel: "a3l", naam: "A3L", breedte_mm: 297, hoogte_mm: 630, standaardvel: false },
    Formulier { sleutel: "a2l", naam: "A2L", breedte_mm: 420, hoogte_mm: 804, standaardvel: false },
    Formulier { sleutel: "a1l", naam: "A1L", breedte_mm: 594, hoogte_mm: 1051, standaardvel: false },
    // Langer dan het grootste vel (1219,2 mm) dat "Microsoft Print to PDF"
    // opgeeft: de scripts slaan hem voor zo'n driver over, het printpad valt
    // terug op het papier van de printer. Een driver die het vel wel aankan
    // krijgt hem wel.
    Formulier { sleutel: "a0l", naam: "A0L", breedte_mm: 841, hoogte_mm: 1399, standaardvel: false },
];

/// Het formulier bij een sleutel uit de Pagina-instelling.
pub fn formulier(sleutel: &str) -> Option<&'static Formulier> {
    FORMULIEREN.iter().find(|f| f.sleutel == sleutel)
}

/// Tekst tussen enkele aanhalingstekens voor PowerShell.
fn ps_tekst(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// De tabel als PowerShell: maten in duizendsten van een millimeter.
fn ps_tabel() -> String {
    let mut uit = String::from("$OpdsForms = @(\n");
    for (i, f) in FORMULIEREN.iter().enumerate() {
        let (b, h) = f.maat_duizendste_mm();
        uit.push_str(&format!(
            "    @{{ Name = {}; Width = {}; Height = {}; Standard = ${} }}{}\n",
            ps_tekst(f.naam),
            b,
            h,
            f.standaardvel,
            if i + 1 < FORMULIEREN.len() { "," } else { "" }
        ));
    }
    uit.push_str(")\n");
    uit
}

/// C#-laag boven winspool: formulieren lezen, toevoegen en verwijderen, en
/// de papierlijst en grootste maat van een driver lezen.
const CSHARP: &str = r#"using System;
using System.Runtime.InteropServices;

namespace OpdsPrint
{
    public static class Spooler
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct FormInfo1
        {
            public uint Flags;
            public IntPtr Name;
            public int Width;
            public int Height;
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PrinterDefaults
        {
            public IntPtr Datatype;
            public IntPtr DevMode;
            public uint DesiredAccess;
        }

        private const uint PrinterAllAccess = 0x000F000C;
        private const uint ServerAccessAdminister = 0x00000001;

        [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool OpenPrinterWith(string name, out IntPtr handle, ref PrinterDefaults defaults);

        [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool OpenPrinterPlain(string name, out IntPtr handle, IntPtr defaults);

        [DllImport("winspool.drv", SetLastError = true)]
        private static extern bool ClosePrinter(IntPtr handle);

        [DllImport("winspool.drv", EntryPoint = "AddFormW", SetLastError = true)]
        private static extern bool AddForm(IntPtr handle, uint level, ref FormInfo1 form);

        [DllImport("winspool.drv", EntryPoint = "DeleteFormW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool DeleteForm(IntPtr handle, string name);

        [DllImport("winspool.drv", EntryPoint = "GetFormW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool GetForm(IntPtr handle, string name, uint level, IntPtr buffer, uint size, out uint needed);

        [DllImport("winspool.drv", EntryPoint = "DeviceCapabilitiesW", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int DeviceCapabilities(string device, string port, ushort capability, IntPtr output, IntPtr devMode);

        // An empty printer name opens the local print server itself.
        private static IntPtr Open(string printer, bool administer)
        {
            string name = String.IsNullOrEmpty(printer) ? null : printer;
            IntPtr handle;
            if (administer)
            {
                PrinterDefaults defaults = new PrinterDefaults();
                defaults.DesiredAccess = name == null ? ServerAccessAdminister : PrinterAllAccess;
                if (OpenPrinterWith(name, out handle, ref defaults)) return handle;
            }
            if (OpenPrinterPlain(name, out handle, IntPtr.Zero)) return handle;
            return IntPtr.Zero;
        }

        // null when no form has this name, else { flags, width, height } in
        // thousandths of a millimetre. Flags 0 = added by a user or a program.
        public static int[] Find(string printer, string name)
        {
            IntPtr handle = Open(printer, false);
            if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                uint needed;
                GetForm(handle, name, 1, IntPtr.Zero, 0, out needed);
                if (needed == 0) return null;
                IntPtr buffer = Marshal.AllocHGlobal((int)needed);
                try
                {
                    if (!GetForm(handle, name, 1, buffer, needed, out needed)) return null;
                    FormInfo1 form = (FormInfo1)Marshal.PtrToStructure(buffer, typeof(FormInfo1));
                    return new int[] { (int)form.Flags, form.Width, form.Height };
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            finally { ClosePrinter(handle); }
        }

        private static int AddOn(string printer, string name, int width, int height)
        {
            IntPtr handle = Open(printer, true);
            if (handle == IntPtr.Zero) return Marshal.GetLastWin32Error();
            IntPtr namePtr = Marshal.StringToHGlobalUni(name);
            try
            {
                FormInfo1 form = new FormInfo1();
                form.Flags = 0;
                form.Name = namePtr;
                form.Width = width;
                form.Height = height;
                form.Left = 0;
                form.Top = 0;
                form.Right = width;
                form.Bottom = height;
                if (AddForm(handle, 1, ref form)) return 0;
                int error = Marshal.GetLastWin32Error();
                return error == 0 ? -1 : error;
            }
            finally
            {
                Marshal.FreeHGlobal(namePtr);
                ClosePrinter(handle);
            }
        }

        public static bool IsExists(int error)
        {
            return error == 80 || error == 183;
        }

        // 0 = added, else the Win32 error. Tried on the printer first and,
        // when that is refused, on the print server.
        public static int Add(string printer, string name, int width, int height)
        {
            int error = AddOn(printer, name, width, height);
            if (error != 0 && !IsExists(error) && !String.IsNullOrEmpty(printer))
            {
                int onServer = AddOn(null, name, width, height);
                if (onServer == 0 || IsExists(onServer)) return onServer;
            }
            return error;
        }

        private static int DeleteOn(string printer, string name)
        {
            IntPtr handle = Open(printer, true);
            if (handle == IntPtr.Zero) return Marshal.GetLastWin32Error();
            try
            {
                if (DeleteForm(handle, name)) return 0;
                int error = Marshal.GetLastWin32Error();
                return error == 0 ? -1 : error;
            }
            finally { ClosePrinter(handle); }
        }

        // 0 = removed, else the Win32 error.
        public static int Delete(string printer, string name)
        {
            int error = DeleteOn(printer, name);
            if (error != 0 && !String.IsNullOrEmpty(printer))
            {
                if (DeleteOn(null, name) == 0) return 0;
            }
            return error;
        }

        // Largest custom paper { width, length } in tenths of a millimetre,
        // or null when the driver does not report one.
        public static int[] MaxExtent(string printer)
        {
            int packed = DeviceCapabilities(printer, null, 5, IntPtr.Zero, IntPtr.Zero);
            if (packed == -1) return null;
            uint value = unchecked((uint)packed);
            int width = (int)(value & 0xFFFF);
            int length = (int)(value >> 16);
            if (width == 0 || length == 0) return null;
            return new int[] { width, length };
        }

        // Paper sizes the driver offers, flattened: width, length, width, ...
        // in tenths of a millimetre.
        public static int[] PaperSizes(string printer)
        {
            int count = DeviceCapabilities(printer, null, 3, IntPtr.Zero, IntPtr.Zero);
            if (count <= 0) return new int[0];
            IntPtr buffer = Marshal.AllocHGlobal(count * 8);
            try
            {
                count = Math.Min(count, DeviceCapabilities(printer, null, 3, buffer, IntPtr.Zero));
                if (count <= 0) return new int[0];
                int[] sizes = new int[count * 2];
                Marshal.Copy(buffer, sizes, 0, count * 2);
                return sizes;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }

        // Paper names the driver offers (what other programs show).
        public static string[] PaperNames(string printer)
        {
            int count = DeviceCapabilities(printer, null, 16, IntPtr.Zero, IntPtr.Zero);
            if (count <= 0) return new string[0];
            IntPtr buffer = Marshal.AllocHGlobal(count * 64 * 2);
            try
            {
                count = Math.Min(count, DeviceCapabilities(printer, null, 16, buffer, IntPtr.Zero));
                if (count <= 0) return new string[0];
                string[] names = new string[count];
                for (int i = 0; i < count; i++)
                {
                    string name = Marshal.PtrToStringUni(new IntPtr(buffer.ToInt64() + i * 128), 64);
                    int end = name.IndexOf('\0');
                    names[i] = (end >= 0 ? name.Substring(0, end) : name).Trim();
                }
                return names;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
    }
}
"#;

/// PowerShell-functies rond de C#-laag: toevoegen, weghalen en de
/// registersleutel die bijhoudt wat van ons is.
const PS_FUNCTIES: &str = r#"# The registry key that lists the forms this program added. Mode 'read',
# 'write' (null when the key is not there) or 'create'. Always the 64-bit
# view, also from the 32-bit installer.
function Open-OpdsMarker([string]$Mode) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
    if ($Mode -eq 'create') { return $base.CreateSubKey($OpdsMarkerKey) }
    return $base.OpenSubKey($OpdsMarkerKey, ($Mode -eq 'write'))
}

function Get-OpdsSizeText($Form) {
    return "$($Form.Name) ($($Form.Width / 1000) x $($Form.Height / 1000) mm)"
}

# Does the form fit the largest custom paper of the driver? An unknown
# maximum counts as fitting: the driver then decides for itself.
function Test-OpdsFits($MaxExtent, $Form) {
    if ($null -eq $MaxExtent) { return $true }
    return (($Form.Width / 100) -le $MaxExtent[0]) -and (($Form.Height / 100) -le $MaxExtent[1])
}

# Positions in the paper list of the driver that have this size (under any
# name), within 1 mm. $Sizes = width, length, width, ... in tenths of a mm.
function Get-OpdsDriverMatches($Sizes, $Form) {
    $w = $Form.Width / 100
    $h = $Form.Height / 100
    $hits = @()
    for ($i = 0; $i + 1 -lt $Sizes.Length; $i += 2) {
        $a = [Math]::Min($Sizes[$i], $Sizes[$i + 1])
        $b = [Math]::Max($Sizes[$i], $Sizes[$i + 1])
        if (([Math]::Abs($a - $w) -le 10) -and ([Math]::Abs($b - $h) -le 10)) { $hits += ($i / 2) }
    }
    return ,$hits
}

# The same size within 1 mm? Forms that come from a driver are often rounded.
function Test-OpdsSameSize($Found, $Form) {
    return ([Math]::Abs($Found[1] - $Form.Width) -le 1000) -and ([Math]::Abs($Found[2] - $Form.Height) -le 1000)
}

# Adds the missing forms. Never changes or replaces an existing form.
# Returns the number of forms that could not be added.
function Add-OpdsForms([string]$Printer) {
    $failed = 0
    $max = [OpdsPrint.Spooler]::MaxExtent($Printer)
    $sizes = [OpdsPrint.Spooler]::PaperSizes($Printer)
    foreach ($form in $OpdsForms) {
        $text = Get-OpdsSizeText $form
        if (-not (Test-OpdsFits $max $form)) {
            Write-Host "Paper size ${text}: skipped, larger than the maximum of '$Printer' ($($max[0] / 10) x $($max[1] / 10) mm)."
            continue
        }
        $found = [OpdsPrint.Spooler]::Find($Printer, $form.Name)
        if ($null -ne $found) {
            if (Test-OpdsSameSize $found $form) {
                Write-Host "Paper size ${text}: already present."
            } else {
                Write-Host "Paper size ${text}: a form named '$($form.Name)' with another size ($($found[1] / 1000) x $($found[2] / 1000) mm) exists; left unchanged."
            }
            continue
        }
        if ($form.Standard -and ((Get-OpdsDriverMatches $sizes $form).Length -gt 0)) {
            Write-Host "Paper size ${text}: the driver already offers this size."
            continue
        }
        $err = [OpdsPrint.Spooler]::Add($Printer, $form.Name, $form.Width, $form.Height)
        if ($err -eq 0) {
            $key = Open-OpdsMarker 'create'
            $key.SetValue($form.Name, "$($form.Width)x$($form.Height)")
            $key.Close()
            Write-Host "Paper size ${text}: added."
        } elseif ([OpdsPrint.Spooler]::IsExists($err)) {
            Write-Host "Paper size ${text}: already exists."
        } else {
            $failed++
            Write-Host "Paper size ${text}: could not be added (Windows error $err)."
        }
    }
    return $failed
}

# Removes only the forms this program added itself (listed in the registry)
# and only while they still are what was added. Returns the number of forms
# that could not be removed.
function Remove-OpdsForms([string]$Printer) {
    $failed = 0
    $key = Open-OpdsMarker 'write'
    if ($null -eq $key) {
        Write-Host "No paper sizes were added by Open PDF Studio."
        return 0
    }
    foreach ($form in $OpdsForms) {
        $text = Get-OpdsSizeText $form
        $mark = $key.GetValue($form.Name, $null)
        if ($null -eq $mark) { continue }
        $found = [OpdsPrint.Spooler]::Find($Printer, $form.Name)
        if ($null -eq $found) {
            $key.DeleteValue($form.Name, $false)
            continue
        }
        if (($found[0] -ne 0) -or ($found[1] -ne $form.Width) -or ($found[2] -ne $form.Height) -or ($mark -ne "$($form.Width)x$($form.Height)")) {
            $key.DeleteValue($form.Name, $false)
            Write-Host "Paper size ${text}: changed since it was added; left in place."
            continue
        }
        $err = [OpdsPrint.Spooler]::Delete($Printer, $form.Name)
        if ($err -eq 0) {
            $key.DeleteValue($form.Name, $false)
            Write-Host "Paper size ${text}: removed."
        } else {
            $failed++
            Write-Host "Paper size ${text}: could not be removed (Windows error $err)."
        }
    }
    $left = $key.ValueCount
    $key.Close()
    if ($left -eq 0) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
        $base.DeleteSubKey($OpdsMarkerKey, $false)
        $parent = Split-Path $OpdsMarkerKey -Parent
        $parentKey = $base.OpenSubKey($parent, $false)
        if (($null -ne $parentKey) -and ($parentKey.SubKeyCount -eq 0) -and ($parentKey.ValueCount -eq 0)) {
            $parentKey.Close()
            $base.DeleteSubKey($parent, $false)
        }
    }
    return $failed
}

# Which of our printers is there to talk to the print server through?
# Empty = the print server itself.
function Get-OpdsFormPrinter {
    foreach ($name in @($OpdsPrinterName, $OpdsLegacyName)) {
        if (Get-Printer -Name $name -ErrorAction SilentlyContinue) { return $name }
    }
    return ''
}
"#;

const KOP: &str = "# GENERATED by src-tauri/src/print_formulieren.rs - do not edit by hand.\n\
# The paper size table and all logic live there; a unit test keeps this file equal to its output.\n";

/// Namen, tabel, C#-laag en functies: het deel dat elk script nodig heeft.
fn ps_basis() -> String {
    format!(
        "$OpdsPrinterName = {}\n$OpdsLegacyName = {}\n$OpdsDriverName = {}\n$OpdsMarkerKey = {}\n\n\
# Paper sizes in thousandths of a millimetre (portrait: width x height).\n{}\n\
$OpdsSource = @'\n{}'@\n\n\
function Initialize-OpdsSpooler {{\n    if (-not ('OpdsPrint.Spooler' -as [type])) {{ Add-Type -TypeDefinition $OpdsSource -Language CSharp }}\n}}\n\n{}",
        ps_tekst(PRINTERNAAM),
        ps_tekst(OUDE_PRINTERNAAM),
        ps_tekst(DRIVERNAAM),
        ps_tekst(REGISTERSLEUTEL),
        ps_tabel(),
        CSHARP,
        PS_FUNCTIES
    )
}

/// Hoe de printer geïnstalleerd wordt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Installatie {
    /// Poortnaam: `POORT_DIALOOG`, of het pad van het opvangbestand.
    pub poort: String,
    /// Een bestaande "Open PDF Printer" (met onze driver) opnieuw aanmaken op
    /// `poort`. De app doet dat als de gebruiker daar zelf om vraagt; het
    /// installatieprogramma nooit: een upgrade laat de printer precies zoals
    /// hij is, ook als hij op de stille opvangpoort staat.
    pub bestaande_vervangen: bool,
}

const PS_INSTALLEREN: &str = r#"
function Test-OpdsOurs($Printer) {
    return ($null -ne $Printer) -and ($Printer.DriverName -eq $OpdsDriverName)
}

function Install-OpdsPrinter([string]$PortName, [bool]$ReplaceExisting, [bool]$OnlyUpgrade) {
    $current = Get-Printer -Name $OpdsPrinterName -ErrorAction SilentlyContinue
    $legacy = Get-Printer -Name $OpdsLegacyName -ErrorAction SilentlyContinue

    # Silent updates: only act when one of our printers is already there, so
    # an update never installs a printer the user did not want.
    if ($OnlyUpgrade -and -not ((Test-OpdsOurs $current) -or (Test-OpdsOurs $legacy))) {
        Write-Host "No virtual printer of Open PDF Studio is installed; nothing to update."
        return
    }

    if (($null -ne $current) -and $ReplaceExisting) {
        if (-not (Test-OpdsOurs $current)) {
            throw "A printer named '$OpdsPrinterName' with another driver ('$($current.DriverName)') exists. It was left unchanged."
        }
        Remove-Printer -Name $OpdsPrinterName
        $current = $null
    }

    if ($null -ne $current) {
        # Never reset an existing printer: it may be on the silent capture port.
        Write-Host "'$OpdsPrinterName' is already installed on port '$($current.PortName)'; left unchanged."
    } else {
        if (-not (Get-PrinterPort -Name $PortName -ErrorAction SilentlyContinue)) { Add-PrinterPort -Name $PortName }
        Add-Printer -Name $OpdsPrinterName -DriverName $OpdsDriverName -PortName $PortName
        # Default paper A4, so the driver or the locale does not pick another size.
        try { Set-PrintConfiguration -PrinterName $OpdsPrinterName -PaperSize A4 -ErrorAction Stop } catch {
            Write-Host "Note: the default paper size could not be set to A4. $($_.Exception.Message)"
        }
        Write-Host "'$OpdsPrinterName' installed on port '$PortName'."
    }

    # The printer of older versions, only when it really is ours and only
    # once the new one is there.
    if ($null -ne $legacy) {
        if (-not (Test-OpdsOurs $legacy)) {
            Write-Host "'$OpdsLegacyName' uses another driver ('$($legacy.DriverName)'); left unchanged."
        } elseif (-not (Test-OpdsOurs (Get-Printer -Name $OpdsPrinterName -ErrorAction SilentlyContinue))) {
            Write-Host "'$OpdsLegacyName' kept: '$OpdsPrinterName' is not a printer of Open PDF Studio."
        } else {
            try {
                Remove-Printer -Name $OpdsLegacyName
                Write-Host "Removed the printer of older versions, '$OpdsLegacyName'."
            } catch {
                Write-Host "Note: '$OpdsLegacyName' could not be removed. $($_.Exception.Message)"
            }
        }
    }

    # Extra paper sizes, measured against our own printer. A failure here
    # never undoes the printer.
    $target = @($OpdsPrinterName, $OpdsLegacyName) | Where-Object {
        Test-OpdsOurs (Get-Printer -Name $_ -ErrorAction SilentlyContinue)
    } | Select-Object -First 1
    if (-not $target) {
        Write-Host "No printer of Open PDF Studio to add the paper sizes to."
        return
    }
    try {
        Initialize-OpdsSpooler
        $failed = Add-OpdsForms $target
        if ($failed -gt 0) { Write-Host "Note: $failed paper size(s) could not be added." }
    } catch {
        Write-Host "Note: the extra paper sizes could not be added. $($_.Exception.Message)"
    }
}

# 'upgrade' as argument: what the installer passes for a silent update.
Install-OpdsPrinter $portName $replaceExisting ($args -contains 'upgrade')
"#;

const PS_VERWIJDEREN: &str = r#"
function Uninstall-OpdsPrinter {
    # Paper sizes first: removing them needs a printer or the print server.
    try {
        Initialize-OpdsSpooler
        $failed = Remove-OpdsForms (Get-OpdsFormPrinter)
        if ($failed -gt 0) { Write-Host "Note: $failed paper size(s) could not be removed." }
    } catch {
        Write-Host "Note: the extra paper sizes could not be removed. $($_.Exception.Message)"
    }

    # Both names, and only printers that use our driver.
    foreach ($name in @($OpdsPrinterName, $OpdsLegacyName)) {
        $printer = Get-Printer -Name $name -ErrorAction SilentlyContinue
        if ($null -eq $printer) { continue }
        if ($printer.DriverName -ne $OpdsDriverName) {
            Write-Host "'$name' uses another driver ('$($printer.DriverName)'); left unchanged."
            continue
        }
        Remove-Printer -Name $name
        Write-Host "Removed '$name'."
    }

    # Ports that only our printers used; a port that is still in use stays.
    Get-PrinterPort | Where-Object {
        $_.Name -like '*OpenPDFStudio*print-capture*' -or $_.Name -like '*OpenPDFPrinter*print-capture*' -or $_.Name -like '*\OpenPDFPrinter\spool\latest.pdf'
    } | ForEach-Object {
        try { Remove-PrinterPort -Name $_.Name -ErrorAction Stop } catch {}
    }
}

Uninstall-OpdsPrinter
"#;

/// Script dat de printer installeert (zie `Installatie`), de printer van
/// oudere versies opruimt en de formulieren toevoegt. Bedoeld om met
/// beheerdersrechten te draaien. Fouten rond de printer zelf zijn
/// `throw`; het script roept nooit `exit` aan, zodat de app het in een eigen
/// `try`-blok kan zetten.
pub fn script_installeren(opties: &Installatie) -> String {
    format!(
        "{KOP}$ErrorActionPreference = 'Stop'\n\n{}\n$portName = {}\n$replaceExisting = ${}\n{}",
        ps_basis(),
        ps_tekst(&opties.poort),
        opties.bestaande_vervangen,
        PS_INSTALLEREN
    )
}

/// Script dat onze formulieren en beide printernamen weghaalt.
pub fn script_verwijderen() -> String {
    format!("{KOP}$ErrorActionPreference = 'Stop'\n\n{}{}", ps_basis(), PS_VERWIJDEREN)
}

const PS_BEHEER: &str = r#"
function Test-OpdsElevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# What the print server and the driver know about each size. Read-only.
function Show-OpdsStatus([string]$Printer) {
    $target = $Printer
    if (-not (Get-Printer -Name $Printer -ErrorAction SilentlyContinue)) {
        Write-Host "Printer '$Printer' is not installed; only the print server is shown."
        $target = ''
    }
    $names = @()
    $sizes = @()
    $max = $null
    if ($target -ne '') {
        $names = [OpdsPrint.Spooler]::PaperNames($target)
        $sizes = [OpdsPrint.Spooler]::PaperSizes($target)
        $max = [OpdsPrint.Spooler]::MaxExtent($target)
        if ($null -ne $max) { Write-Host "Largest custom paper of '$target': $($max[0] / 10) x $($max[1] / 10) mm." }
        Write-Host "'$target' offers $($names.Length) paper sizes to other programs (DC_PAPERNAMES)."
    }
    $key = Open-OpdsMarker 'read'
    foreach ($form in $OpdsForms) {
        $found = [OpdsPrint.Spooler]::Find($target, $form.Name)
        if ($null -eq $found) { $server = 'no form' }
        else {
            $kind = @('added by a user or a program', 'built into Windows', 'from a printer driver')[[Math]::Min($found[0], 2)]
            $server = "form $($found[1] / 1000) x $($found[2] / 1000) mm, $kind"
        }
        $ours = ($null -ne $key) -and ($null -ne $key.GetValue($form.Name, $null))
        # What other programs see: the name in DC_PAPERNAMES, and under which
        # names the driver offers this size.
        $byName = $names -contains $form.Name
        $bySize = @((Get-OpdsDriverMatches $sizes $form) | Where-Object { $_ -lt $names.Length } | ForEach-Object { "'$($names[$_])'" }) -join ', '
        if ($bySize -eq '') { $bySize = 'not offered' }
        $fits = Test-OpdsFits $max $form
        Write-Host (Get-OpdsSizeText $form)
        Write-Host "    print server                    : $server"
        Write-Host "    added by Open PDF Studio        : $ours"
        Write-Host "    '$($form.Name)' in DC_PAPERNAMES of the printer: $byName"
        Write-Host "    this size in the printer's list : $bySize"
        Write-Host "    fits the largest custom paper   : $fits"
    }
    if ($null -ne $key) { $key.Close() }
}

Initialize-OpdsSpooler

if ($Action -eq 'status') {
    Show-OpdsStatus $Printer
    return
}

if (-not (Test-OpdsElevated)) {
    Write-Host "'$Action' changes the print server and needs an elevated PowerShell (Run as administrator). Nothing was changed."
    exit 1
}

if ($Action -eq 'add') {
    if (-not (Get-Printer -Name $Printer -ErrorAction SilentlyContinue)) {
        Write-Host "Printer '$Printer' is not installed. Nothing was changed."
        exit 1
    }
    $failed = Add-OpdsForms $Printer
} else {
    $target = $Printer
    if (-not (Get-Printer -Name $Printer -ErrorAction SilentlyContinue)) { $target = '' }
    $failed = Remove-OpdsForms $target
}
Write-Host ''
Show-OpdsStatus $Printer
if ($failed -gt 0) { exit 2 }
"#;

/// Los script voor de beheerder: de formulieren toevoegen of weghalen zonder
/// de printer aan te raken, en laten zien of de printer ze aanbiedt aan
/// andere programma's. `status` leest alleen en heeft geen rechten nodig.
pub fn script_beheer() -> String {
    format!(
        "{KOP}\
# Paper sizes for the virtual printer '{PRINTERNAAM}': show, add or remove them.\n\
#\n\
# The sizes are added to the Windows print server as forms. A printer offers a form to other\n\
# programs only when its driver accepts user-defined paper sizes; the status shows, per size,\n\
# whether the printer lists it (DC_PAPERNAMES). The built-in 'Microsoft Print to PDF' driver has\n\
# a fixed paper list: check the status after 'add' to see whether it takes these sizes at all.\n\
#\n\
#   .\\open-pdf-printer-forms.ps1                 status only, changes nothing\n\
#   .\\open-pdf-printer-forms.ps1 -Action add     add the missing sizes   (elevated PowerShell)\n\
#   .\\open-pdf-printer-forms.ps1 -Action remove  remove the sizes added  (elevated PowerShell)\n\
#\n\
# 'add' never changes an existing form; 'remove' only removes what 'add', the installer or the\n\
# app added. Both can be repeated safely. The printer itself is never touched.\n\
param(\n    [ValidateSet('status', 'add', 'remove')]\n    [string]$Action = 'status',\n    [string]$Printer = {}\n)\n\n\
$ErrorActionPreference = 'Stop'\n\n{}{}",
        ps_tekst(PRINTERNAAM),
        ps_basis(),
        PS_BEHEER
    )
}

/// De scriptbestanden in de repo die uit deze module komen: pad ten opzichte
/// van `src-tauri/` en de inhoud.
pub fn scriptbestanden() -> Vec<(&'static str, String)> {
    vec![
        (
            "nsis/install-printer.ps1",
            // Het installatieprogramma draait met beheerdersrechten van wie
            // dan ook en per machine; het opvangbestand staat in het profiel
            // van één gebruiker. Daarom hier de dialoogpoort; de app schakelt
            // per gebruiker over op de stille opvang.
            script_installeren(&Installatie { poort: POORT_DIALOOG.to_string(), bestaande_vervangen: false }),
        ),
        ("nsis/uninstall-printer.ps1", script_verwijderen()),
        ("../scripts/open-pdf-printer-forms.ps1", script_beheer()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verlengd_vel_is_het_basisvel_plus_een_a4_breedte() {
        let basis = [("a3l", 297, 420), ("a2l", 420, 594), ("a1l", 594, 841), ("a0l", 841, 1189)];
        for (sleutel, breedte, hoogte) in basis {
            let f = formulier(sleutel).unwrap();
            assert_eq!((f.breedte_mm, f.hoogte_mm), (breedte, hoogte + VERLENGING_MM), "{sleutel}");
        }
        assert_eq!(formulier("a3l").map(|f| (f.breedte_mm, f.hoogte_mm)), Some((297, 630)));
        assert_eq!(formulier("a2l").map(|f| (f.breedte_mm, f.hoogte_mm)), Some((420, 804)));
        assert_eq!(formulier("a1l").map(|f| (f.breedte_mm, f.hoogte_mm)), Some((594, 1051)));
        assert_eq!(formulier("a0l").map(|f| (f.breedte_mm, f.hoogte_mm)), Some((841, 1399)));
    }

    #[test]
    fn tabel_is_staand_uniek_en_past_in_een_devmode() {
        for f in FORMULIEREN {
            assert!(f.breedte_mm < f.hoogte_mm, "{} staat niet staand", f.naam);
            // dmPaperWidth / dmPaperLength zijn i16 in 0,1 mm.
            let (b, l) = f.maat_tiende_mm();
            assert!(b <= i16::MAX as i32 && l <= i16::MAX as i32, "{} past niet in een DEVMODE", f.naam);
            assert_eq!(f.sleutel, f.naam.to_lowercase());
            // Formuliernamen zijn op de printserver hooguit 31 tekens.
            assert!(f.naam.len() <= 31 && f.naam.is_ascii());
        }
        let mut sleutels: Vec<_> = FORMULIEREN.iter().map(|f| f.sleutel).collect();
        sleutels.sort_unstable();
        sleutels.dedup();
        assert_eq!(sleutels.len(), FORMULIEREN.len());
        assert_eq!(formulier("a4"), None);
        assert_eq!(formulier("A3L"), None);
    }

    #[test]
    fn alleen_a1_en_a0_zijn_standaardvellen() {
        let standaard: Vec<_> = FORMULIEREN.iter().filter(|f| f.standaardvel).map(|f| f.naam).collect();
        assert_eq!(standaard, vec!["A1", "A0"]);
    }

    #[test]
    fn a0l_past_niet_in_de_pdf_driver_de_rest_wel() {
        // DC_MAXEXTENT van "Microsoft Print to PDF": 914,4 x 1219,2 mm.
        let pdf_driver = Some((9144, 12192));
        for f in FORMULIEREN {
            assert_eq!(f.past_binnen(pdf_driver), f.sleutel != "a0l", "{}", f.naam);
            assert!(f.past_binnen(None), "{}: onbekende grens telt als passend", f.naam);
        }
        // Een plotter die 1,5 m aankan neemt ook A0L.
        assert!(formulier("a0l").unwrap().past_binnen(Some((9144, 15000))));
        // Te smal is ook niet passend.
        assert!(!formulier("a0").unwrap().past_binnen(Some((8000, 20000))));
    }

    #[test]
    fn elk_script_bevat_elke_maat_in_duizendsten_van_een_millimeter() {
        let installeren = script_installeren(&Installatie { poort: POORT_DIALOOG.into(), bestaande_vervangen: false });
        for script in [installeren, script_verwijderen(), script_beheer()] {
            for f in FORMULIEREN {
                let (b, h) = f.maat_duizendste_mm();
                let regel = format!(
                    "@{{ Name = '{}'; Width = {b}; Height = {h}; Standard = ${} }}",
                    f.naam, f.standaardvel
                );
                assert!(script.contains(&regel), "ontbreekt: {regel}");
            }
        }
        let tabel = ps_tabel();
        assert!(tabel.contains("Name = 'A1'; Width = 594000; Height = 841000; Standard = $true"));
        assert!(tabel.contains("Name = 'A0'; Width = 841000; Height = 1189000; Standard = $true"));
        assert!(tabel.contains("Name = 'A3L'; Width = 297000; Height = 630000; Standard = $false"));
        assert!(tabel.contains("Name = 'A2L'; Width = 420000; Height = 804000; Standard = $false"));
        assert!(tabel.contains("Name = 'A1L'; Width = 594000; Height = 1051000; Standard = $false"));
        assert!(tabel.contains("Name = 'A0L'; Width = 841000; Height = 1399000; Standard = $false"));
        assert_eq!(tabel.matches("@{").count(), FORMULIEREN.len());
    }

    #[test]
    fn installatiescript_van_het_installatieprogramma_laat_een_bestaande_printer_staan() {
        let s = script_installeren(&Installatie { poort: POORT_DIALOOG.into(), bestaande_vervangen: false });
        assert!(s.contains("$OpdsPrinterName = 'Open PDF Printer'"));
        assert!(s.contains("$OpdsLegacyName = 'Open PDF Studio'"));
        assert!(s.contains("$OpdsDriverName = 'Microsoft Print to PDF'"));
        assert!(s.contains("$portName = 'PORTPROMPT:'"));
        assert!(s.contains("$replaceExisting = $false"));
        // De enige Add-Printer zit in de tak "er is nog geen printer".
        assert_eq!(s.matches("Add-Printer ").count(), 1);
        let geen_printer = s.find("} else {\n        if (-not (Get-PrinterPort").expect("tak zonder printer");
        assert!(s.find("Add-Printer ").unwrap() > geen_printer);
        // Geen enkele Set-Printer: een bestaande printer houdt zijn poort.
        assert!(!s.contains("Set-Printer "));
    }

    #[test]
    fn oude_printer_gaat_alleen_weg_met_onze_driver_en_pas_na_de_nieuwe() {
        let s = script_installeren(&Installatie { poort: POORT_DIALOOG.into(), bestaande_vervangen: false });
        let toevoegen = s.find("Add-Printer ").unwrap();
        let oude_weg = s.find("Remove-Printer -Name $OpdsLegacyName").unwrap();
        assert!(oude_weg > toevoegen, "de oude printer moet ná de nieuwe aan de beurt zijn");
        let bewaking = s.find("if (-not (Test-OpdsOurs $legacy))").unwrap();
        assert!(bewaking < oude_weg);
        assert!(s.contains("$Printer.DriverName -eq $OpdsDriverName"));
        // Verwijderen: beide namen, met dezelfde bewaking op de driver.
        let v = script_verwijderen();
        assert!(v.contains("foreach ($name in @($OpdsPrinterName, $OpdsLegacyName))"));
        assert!(v.contains("if ($printer.DriverName -ne $OpdsDriverName)"));
        assert!(v.find("$printer.DriverName -ne $OpdsDriverName").unwrap() < v.find("Remove-Printer -Name $name").unwrap());
    }

    #[test]
    fn app_installatie_op_de_opvangpoort_met_aanhalingsteken_in_het_pad() {
        let pad = r"C:\Users\O'Neil\AppData\Local\OpenPDFPrinter\spool\latest.pdf";
        let s = script_installeren(&Installatie { poort: pad.into(), bestaande_vervangen: true });
        assert!(s.contains(r"$portName = 'C:\Users\O''Neil\AppData\Local\OpenPDFPrinter\spool\latest.pdf'"));
        assert!(s.contains("$replaceExisting = $true"));
        // Ook dan blijft een printer met een andere driver staan.
        assert!(s.contains("with another driver"));
    }

    #[test]
    fn scripts_passen_in_het_try_blok_van_de_app() {
        let installeren = script_installeren(&Installatie { poort: POORT_DIALOOG.into(), bestaande_vervangen: true });
        for s in [installeren, script_verwijderen()] {
            // `exit` zou het schrijven van het resultaat overslaan, een
            // param-blok mag niet binnen `try`.
            assert!(!s.lines().any(|r| r.trim_start().starts_with("exit")), "exit in een ingebed script");
            assert!(!s.contains("param("));
            // De here-string met C# sluit op kolom 0.
            assert!(s.contains("\n'@\n"));
            assert_eq!(s.matches("@'").count(), 1);
        }
    }

    #[test]
    fn formulieren_nooit_overschrijven_en_alleen_eigen_formulieren_weghalen() {
        let s = script_verwijderen();
        // Geen SetForm: een bestaand formulier wordt nooit aangepast.
        assert!(!CSHARP.contains("SetForm"));
        // Weghalen loopt via de registersleutel en controleert soort en maat.
        assert!(s.contains("$OpdsMarkerKey = 'SOFTWARE\\OpenPDFPrinter\\Forms'"));
        assert!(s.contains("if ($null -eq $mark) { continue }"));
        assert!(s.contains("($found[0] -ne 0)"));
        // Toevoegen: bestaat de naam al, dan overslaan (ook met een andere
        // maat); "bestaat al" is geen fout.
        assert!(PS_FUNCTIES.contains("if ($null -ne $found) {"));
        let bestaat = PS_FUNCTIES.find("if ($null -ne $found) {").unwrap();
        let toevoegen = PS_FUNCTIES.find("[OpdsPrint.Spooler]::Add(").unwrap();
        let verder = PS_FUNCTIES[bestaat..toevoegen].matches("continue").count();
        assert!(verder >= 2, "een bestaand formulier moet vóór het toevoegen afvallen");
        assert!(CSHARP.contains("error == 80 || error == 183"));
        // 64-bits registerweergave, ook vanuit het 32-bits installatieprogramma.
        assert!(PS_FUNCTIES.contains("[Microsoft.Win32.RegistryView]::Registry64"));
    }

    #[test]
    fn beheerscript_wijzigt_niets_zonder_beheerdersrechten() {
        let s = script_beheer();
        assert!(s.contains("[ValidateSet('status', 'add', 'remove')]"));
        assert!(s.contains("[string]$Action = 'status'"));
        let status = s.find("if ($Action -eq 'status')").unwrap();
        let rechten = s.find("if (-not (Test-OpdsElevated))").unwrap();
        let toevoegen = s.find("$failed = Add-OpdsForms $Printer").unwrap();
        let weghalen = s.find("$failed = Remove-OpdsForms $target").unwrap();
        assert!(status < rechten && rechten < toevoegen && rechten < weghalen);
        // Het beheerscript raakt de printer zelf nooit aan.
        for verboden in ["Add-Printer ", "Remove-Printer ", "Set-Printer ", "Add-PrinterPort", "Remove-PrinterPort"] {
            assert!(!s.contains(verboden), "{verboden} in het beheerscript");
        }
        assert!(s.contains("PaperNames"));
    }

    #[test]
    fn scripts_zijn_ascii() {
        // Windows PowerShell leest een .ps1 zonder BOM als ANSI.
        for (pad, inhoud) in scriptbestanden() {
            assert!(inhoud.is_ascii(), "{pad} bevat niet-ASCII-tekens");
            assert!(!inhoud.contains('\r'), "{pad} bevat CR");
        }
    }

    #[test]
    fn scriptbestanden_zijn_de_uitvoer_van_deze_module() {
        let basis = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let schrijven = std::env::var_os("OPDS_SCHRIJF_SCRIPTS").is_some();
        for (pad, verwacht) in scriptbestanden() {
            let bestand = basis.join(pad);
            if schrijven {
                std::fs::write(&bestand, &verwacht).unwrap_or_else(|e| panic!("{}: {e}", bestand.display()));
                continue;
            }
            let inhoud = std::fs::read_to_string(&bestand).unwrap_or_else(|e| panic!("{}: {e}", bestand.display()));
            // Git kan regeleinden omzetten; de inhoud telt.
            assert!(
                inhoud.replace("\r\n", "\n") == verwacht,
                "{} loopt achter op print_formulieren.rs; schrijf opnieuw met OPDS_SCHRIJF_SCRIPTS=1",
                bestand.display()
            );
        }
    }
}
