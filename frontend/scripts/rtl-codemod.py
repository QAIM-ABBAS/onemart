#!/usr/bin/env python3
"""Converts physical Tailwind classes to logical (RTL-safe) ones. Idempotent.
Usage: python scripts/rtl-codemod.py [src_dir] [--dry]"""
import re, sys, pathlib

args = [a for a in sys.argv[1:] if not a.startswith('--')]
DRY = '--dry' in sys.argv
ROOT = pathlib.Path(args[0] if args else 'src')
EXTS = {'.tsx', '.ts', '.jsx', '.js', '.css'}
B = r'(?<![A-Za-z0-9_])'  # token must not be glued to a preceding word character

DIR = {'l': 's', 'r': 'e', 'tl': 'ss', 'tr': 'se', 'bl': 'es', 'br': 'ee'}
RULES = [
    # margin / padding
    (re.compile(B + r'(ml|mr|pl|pr)-'),
     lambda m: {'ml': 'ms', 'mr': 'me', 'pl': 'ps', 'pr': 'pe'}[m.group(1)] + '-'),
    # inset (skip centering pattern left-1/2 / right-1/2, and CSS property names)
    (re.compile(r'(?<![A-Za-z0-9_])(?<!border-)(?<!margin-)(?<!padding-)(left|right)-(?!1/2\b)'),
     lambda m: ('start' if m.group(1) == 'left' else 'end') + '-'),
    # text align
    (re.compile(B + r'text-(left|right)(?![-\w])'),
     lambda m: 'text-' + ('start' if m.group(1) == 'left' else 'end')),
    # border sides
    (re.compile(B + r'border-(l|r)(?![A-Za-z])'), lambda m: 'border-' + DIR[m.group(1)]),
    # rounded corners
    (re.compile(B + r'rounded-(tl|tr|bl|br|l|r)(?![A-Za-z])'),
     lambda m: 'rounded-' + DIR[m.group(1)]),
    # float / clear
    (re.compile(B + r'(float|clear)-(left|right)\b'),
     lambda m: f"{m.group(1)}-{'start' if m.group(2) == 'left' else 'end'}"),
]
# space-x / divide-x do not flip by themselves: add the rtl reverse helper
SPACE = re.compile(B + r'(space|divide)-x(?:-[A-Za-z0-9./\[\]%]+)?')
CSS_PROPS = [
    (r'(?<![\w-])margin-left\b', 'margin-inline-start'),
    (r'(?<![\w-])margin-right\b', 'margin-inline-end'),
    (r'(?<![\w-])padding-left\b', 'padding-inline-start'),
    (r'(?<![\w-])padding-right\b', 'padding-inline-end'),
    (r'(?<![\w-])border-left\b', 'border-inline-start'),
    (r'(?<![\w-])border-right\b', 'border-inline-end'),
    (r'text-align:\s*left', 'text-align: start'),
    (r'text-align:\s*right', 'text-align: end'),
    (r'(?<![\w-])float:\s*left', 'float: inline-start'),
    (r'(?<![\w-])float:\s*right', 'float: inline-end'),
    (r'(?<![\w-])left:', 'inset-inline-start:'),
    (r'(?<![\w-])right:', 'inset-inline-end:'),
]

def add_reverse(line):
    def rep(m):
        tok = m.group(0)
        if tok.endswith('reverse'):
            return tok
        return f'{tok} rtl:{m.group(1)}-x-reverse'
    out = SPACE.sub(rep, line)
    out = re.sub(r'(rtl:(?:space|divide)-x-reverse)(?: \1)+', r'\1', out)
    return out

def process(text, is_css):
    for rx, fn in RULES:
        text = rx.sub(fn, text)
    lines = []
    for line in text.split('\n'):
        if 'rtl:space-x-reverse' in line or 'rtl:divide-x-reverse' in line:
            lines.append(line)
        else:
            lines.append(add_reverse(line))
    text = '\n'.join(lines)
    if is_css:
        for pat, repl in CSS_PROPS:
            text = re.sub(pat, repl, text)
    return text

changed = 0
for p in ROOT.rglob('*'):
    if p.suffix not in EXTS or 'node_modules' in p.parts or 'locales' in p.parts:
        continue
    old = p.read_text(encoding='utf-8')
    new = process(old, p.suffix == '.css')
    if new != old:
        changed += 1
        print(('would change ' if DRY else 'changed ') + str(p))
        if not DRY:
            p.write_text(new, encoding='utf-8')
print(f'{changed} file(s) {"would change" if DRY else "changed"}')
