"""Exercise production OS enumeration with a TTF and both faces of a TTC.
Linux uses an isolated Fontconfig catalogue. Windows/macOS registration is
restricted to disposable CI runners; user font folders are never modified.
Usage: python run.py /path/to/font-catalogue-probe [output.json]
"""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from xml.sax.saxutils import escape

fixtures = Path(__file__).resolve().parent / 'fixtures'
fonts = [fixtures / 'installed.ttf', fixtures / 'collection.ttc']
expected = ['OPDS Installed Fixture', 'OPDS Collection One', 'OPDS Collection 日本語']
env = os.environ.copy()
cleanup = []
try:
    with tempfile.TemporaryDirectory(prefix='opds-font-catalogue-') as temp:
        if sys.platform.startswith('linux'):
            config = Path(temp) / 'fonts.conf'
            config.write_text('<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">'
                              '<fontconfig><dir>' + escape(str(fixtures)) + '</dir><cachedir>'
                              + escape(temp) + '</cachedir></fontconfig>')
            env['FONTCONFIG_FILE'] = str(config)
        elif sys.platform == 'win32':
            if os.environ.get('GITHUB_ACTIONS') != 'true':
                raise RuntimeError('Windows font registration is restricted to disposable CI runners')
            import winreg
            import shutil
            directory = Path(os.environ['LOCALAPPDATA']) / 'Microsoft' / 'Windows' / 'Fonts'
            directory.mkdir(parents=True, exist_ok=True)
            registry = r'Software\Microsoft\Windows NT\CurrentVersion\Fonts'
            for source in fonts:
                target = directory / ('opds-1011-test-' + source.name)
                if target.exists():
                    raise RuntimeError('refusing to overwrite an existing font fixture')
                shutil.copyfile(source, target)
                cleanup.append(lambda path=target: path.unlink())
                name = 'OPDS 1011 Test ' + source.name
                with winreg.CreateKey(winreg.HKEY_CURRENT_USER, registry) as key:
                    winreg.SetValueEx(key, name, 0, winreg.REG_SZ, str(target))
                def remove_value(name=name):
                    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, registry, 0, winreg.KEY_SET_VALUE) as key:
                        winreg.DeleteValue(key, name)
                cleanup.append(remove_value)
                add = ctypes.windll.gdi32.AddFontResourceExW
                add.argtypes = [ctypes.c_wchar_p, ctypes.c_uint, ctypes.c_void_p]
                assert add(str(target), 0, None) > 0, 'AddFontResourceExW failed'
                remove = ctypes.windll.gdi32.RemoveFontResourceExW
                remove.argtypes = add.argtypes
                cleanup.append(lambda path=target: remove(str(path), 0, None))
        elif sys.platform == 'darwin':
            if os.environ.get('GITHUB_ACTIONS') != 'true':
                raise RuntimeError('macOS font registration is restricted to disposable CI runners')
            cf = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
            ct = ctypes.CDLL('/System/Library/Frameworks/CoreText.framework/CoreText')
            cf.CFURLCreateFromFileSystemRepresentation.restype = ctypes.c_void_p
            cf.CFURLCreateFromFileSystemRepresentation.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long, ctypes.c_bool]
            cf.CFRelease.argtypes = [ctypes.c_void_p]
            ct.CTFontManagerRegisterFontsForURL.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p]
            ct.CTFontManagerRegisterFontsForURL.restype = ctypes.c_bool
            ct.CTFontManagerUnregisterFontsForURL.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p]
            for source in fonts:
                data = os.fsencode(source)
                url = cf.CFURLCreateFromFileSystemRepresentation(None, data, len(data), False)
                cleanup.append(lambda url=url: cf.CFRelease(url))
                assert ct.CTFontManagerRegisterFontsForURL(url, 3, None), 'CoreText session registration failed'
                cleanup.append(lambda url=url: ct.CTFontManagerUnregisterFontsForURL(url, 3, None))
        else:
            raise RuntimeError('unsupported desktop platform')
        result = subprocess.run([sys.argv[1], *expected], env=env, text=True, encoding='utf-8', capture_output=True, check=True)
        families = json.loads(result.stdout)
        assert all(name in families for name in expected)
        if len(sys.argv) > 2:
            Path(sys.argv[2]).write_text(result.stdout, encoding='utf-8')
        print(json.dumps({'families': len(families), 'fixtureFamilies': expected}, ensure_ascii=False))
finally:
    for action in reversed(cleanup):
        action()
