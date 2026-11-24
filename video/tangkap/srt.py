"""Caption timings in video/index.html (.cap clips written by the engine) -> SubRip file. Usage: python3 video/tangkap/srt.py <out.srt>"""
import html
import re
import sys


def ts(x):
    ms = int(round(x * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


src = open("video/index.html", encoding="utf-8").read()
caps = re.findall(r'class="clip cap" data-start="([\d.]+)" data-duration="([\d.]+)"[^>]*><span>(.*?)</span>', src)
rows = sorted((float(a), float(a) + float(d), html.unescape(t)) for a, d, t in caps)
with open(sys.argv[1], "w", encoding="utf-8") as f:
    for i, (a, b, t) in enumerate(rows, 1):
        f.write("%d\n%s --> %s\n%s\n\n" % (i, ts(a), ts(b), t))
print(len(rows), "cues")
