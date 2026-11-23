"""Regenerates public/fonts/: the 7 font styles the site uses, subset to Latin +
Romanian. Needs fonttools + brotli (pip install fonttools brotli), run from the
repo root:  python3 tools/fonts/subset.py public/fonts
Each style is two files (Latin, and the Romanian letters ă ș ț), matched by
unicode-range in src/styles/fonts.css."""
import subprocess, os, sys, shutil
F='node_modules/@fontsource'
OUT=sys.argv[1] if len(sys.argv) > 1 else 'public/fonts'
SUBSET=shutil.which('pyftsubset') or 'pyftsubset'
os.makedirs(OUT, exist_ok=True)
LATIN="U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201E,U+2022,U+2026,U+20AC,U+2190-2193,U+2212,U+21BA"
RO="U+0102-0103,U+0218-021B,U+015E-015F,U+0162-0163"
tot_old=tot_new=0
for fam,w,st in [("barlow",400,"normal"),("barlow",600,"normal"),("barlow",700,"normal"),("barlow-condensed",700,"normal"),("barlow-condensed",800,"normal"),("barlow-condensed",800,"italic"),("barlow-condensed",900,"italic")]:
    n=f"{fam}-{w}-{st}"
    for sub,uni,feat,suffix in (("latin",LATIN,"kern,liga",""),("latin-ext",RO,"kern","-ro")):
        src=f"{F}/{fam}/files/{fam}-{sub}-{w}-{st}.woff2"; dst=f"{OUT}/{n}{suffix}.woff2"
        subprocess.run([SUBSET,src,f"--unicodes={uni}","--flavor=woff2",f"--layout-features={feat}","--no-hinting","--desubroutinize",f"--output-file={dst}"],check=True,capture_output=True)
        tot_old+=os.path.getsize(src); tot_new+=os.path.getsize(dst)
        print(f"{n}{suffix:4} {os.path.getsize(src):6} -> {os.path.getsize(dst):6}")
print("total", tot_old, "->", tot_new)
