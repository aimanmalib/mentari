"""Writes video/filem.json for the eight-scene film: every on-screen value is read from evidence/testnet.json, the capture log
and boxes (video/tangkap/) and a real `pnpm demo` run (video/tangkap/verify.txt). Picture moments are measured from the voice:
each one is a phrase in a narration line, timed with the character timings the voice engine returned (video/work/suara/<id>.json).
Run from the repo root after the voice step: python3 video/tangkap/teks.py"""
import glob
import json
import os
import struct

EV = json.load(open("evidence/testnet.json"))
LOG = json.load(open("video/tangkap/log.json"))
KOTAK = json.load(open("video/tangkap/kotak.json"))
VERIFY = [l.rstrip() for l in open("video/tangkap/verify.txt") if l.strip() and not l.startswith("$")]
CASES = {c["id"]: c for c in EV["cases"]}
SUARA_DIR = "video/work/suara/"

# Scene order with the quiet time before and after each narration line (s). The film length follows from the voice.
ADEGAN = [("hook", .4, 3.6), ("retire", 2.4, 7.0), ("gagal", 1.6, 7.4), ("verify", 1.4, 5.6), ("meter", 1.4, 6.0),
          ("native", 1.4, 7.0), ("demo", 1.2, 6.4), ("tutup", 1.0, 4.6)]
TEMPOH_JULAT = (150.0, 170.0)


def tinggi():
    """Page height in CSS px of every capture (PNG height / 2, the capture's device scale)."""
    out = {}
    for f in sorted(glob.glob("video/assets/shots/*.png")):
        with open(f, "rb") as fh:
            out[os.path.basename(f)[:-4]] = struct.unpack(">II", fh.read(24)[16:24])[1] // 2
    return out


DOCS_Y0 = 8400  # the docs capture is 19 000 CSS px tall; the film uses the 2 400 px around the flag, cut once here


def potong_docs():
    """video/assets/shots/docs-flag.png: the part of the docs page around the "Not yet tested" flag."""
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    im = Image.open("video/assets/shots/docs.png")
    im.crop((0, DOCS_Y0 * 2, im.width, (DOCS_Y0 + 2400) * 2)).save("video/assets/shots/docs-flag.png", optimize=True)


def suara(i):
    al = json.load(open(SUARA_DIR + i + ".json"))["al"]
    return "".join(al["characters"]), al["character_start_times_seconds"], al["character_end_times_seconds"][-1]


def jadual():
    """→ (B scene windows, mula per voice id, film length, phrase timer)."""
    t, B, mula, al = 0.0, {}, {}, {}
    for i, lead, tail in ADEGAN:
        al[i] = suara(i)
        mula[i] = round(t + lead, 2)
        hujung = round(mula[i] + al[i][2] + tail, 2)
        B[i] = (round(t, 2), hujung)
        t = hujung
    tempoh = round(t, 1)
    if not TEMPOH_JULAT[0] <= tempoh <= TEMPOH_JULAT[1]:
        raise SystemExit("film length %.1f s is outside %s" % (tempoh, TEMPOH_JULAT))

    def w(i, frasa, off=0.0):
        """Film time at which the voice starts saying `frasa` in line i."""
        teks, st, _ = al[i]
        return round(mula[i] + st[teks.index(frasa)] + off, 2)
    return B, mula, tempoh, w


def kes(c, keys):
    """A case from evidence/testnet.json as the JSON lines a reader would see, only the listed keys."""
    return json.dumps({k: c[k] for k in keys if k in c}, indent=2)


def kes_i():
    """Case I, first step: the retire signed with the classical key alone, as recorded."""
    c = CASES["I"]["classic"]
    v = {"id": "I", "function": c["function"], "signed_with": c["signed_with"], "window_before": c["window_before"],
         "refused": c["refused"], "before": {"nonce": c["before"]["nonce"], "retirementsCount": c["before"]["retirementsCount"]},
         "after": {"nonce": c["after"]["nonce"], "retirementsCount": c["after"]["retirementsCount"]}}
    return json.dumps(v, indent=2)


def momen(B, w):
    """Picture moments (film seconds), each tied to the words it illustrates."""
    T = {
        "burn": w("hook", "the burn"), "receipt": w("hook", "the public record"), "fails": w("hook", "They can disagree"),
        "klik": w("retire", "I press", .55), "kira": w("retire", "Both ledgers"), "exp": w("retire", "The explorer", -.2),
        "safe": w("retire", "signed with"),
        "g_klik": w("gagal", "This button", .4), "g_kira": w("gagal", "The receipt count"), "g_exp": w("gagal", "The chain undid", -.2),
        "g_other": w("gagal", "The other two"), "g_kd": w("gagal", "at the bridge", .2),
        "v_agree": w("verify", "The page reads"), "v_names": w("verify", "Each one names"), "v_pq": w("verify", "Then your browser", -.3),
        "m_pqc": w("meter", "The contract checks"), "m_e": w("meter", "A reading signed", -.2), "m_e_hi": w("meter", "mints nothing"),
        "m_i": w("meter", "A classical key", -.2), "m_i_hi": w("meter", "the chain refuses"),
        "n_flag": w("native", "The docs mark"), "n_ran": w("native", "I ran it", .4), "n_safe": w("native", "One hybrid-signed"),
        "n_cross": w("native", "ran the contract"), "n_how": w("native", "Retire now uses", -.2),
        "d_cmd": w("demo", "and run"), "tu2": w("tutup", "The signatures"), "akhir": w("tutup", "I built", -.4),
    }
    T["hasil"] = round(T["klik"] + 1.5, 2)
    T["g_hasil"] = round(T["g_klik"] + 1.4, 2)
    T["g_kc"] = round(T["g_other"] + .9, 2)
    T["g_akhir"] = round(T["g_kd"] + 1.4, 2)
    T["d_ok"] = round(B["demo"][1] - 2.4, 2)
    return T


def main():
    B, mula, tempoh, w = jadual()
    potong_docs()
    T = momen(B, w)
    retire, b = LOG["try-retire"]["body"], LOG["try-b"]["body"]
    teks = {
        "label_ai": "Narration: an AI clone of the author's voice (ElevenLabs) · Music: Sascha Ende, ende.app (CC BY 4.0)",
        "hos": "mentari.sasateguh.com",
        "hook_k": "The problem", "hook_h": "One certificate. Two stories.",
        "retire_k": "/try · Retire now", "retire_h": "One transaction. Both ledgers move.",
        "gagal_k": "/try · Make it fail", "gagal_h": "It fails. Nothing is kept.",
        "verify_k": "/verify", "verify_h": "Both records, checked again in your browser.",
        "meter_k": "Meter readings · ML-DSA-87", "meter_h": "Signed by the meter. Checked on chain.",
        "native_k": "Cross-VM · Native to EVM", "native_h": "Marked untested. I ran it.",
        "demo_k": "pnpm demo", "demo_h": "Check it yourself. No keys.",
        "tutup_1": "The meters are simulated.", "tutup_2": "The signatures and the chain are real.",
        "akhir_h": "Retire a solar certificate once: burn and receipt together, or not at all.",
        "akhir_url": "mentari.sasateguh.com",
        "akhir_repo": "github.com/aimanmalib/mentari",
        "akhir_sub": "Build Before Q-Day · Cross-VM · QoreChain testnet · Apache-2.0",
        "sketsa_evm": "EVM ledger", "sketsa_native": "Native ledger", "sketsa_sijil": "Certificate · 500 Wh",
        "sketsa_bakar": "Burned", "sketsa_resit": "Receipt written", "sketsa_gagal": "Receipt failed",
        "sketsa_dua": "Retired here. Not retired there.",
        "kes_e": kes(CASES["E"], ["id", "title", "function", "status", "revert_reason", "receipts", "height"]),
        "kes_i": kes_i(),
        "kes_cd": json.dumps([{k: CASES[i][k] for k in ("id", "status", "receipts")} for i in ("C", "D")], indent=2),
        "verify_out": "\n".join(VERIFY),
        "kotak": json.dumps(KOTAK),
        "plan": json.dumps({"B": B, "T": T, "H": tinggi(), "docsY0": DOCS_Y0}),
        "exp_retire": "explore.qore.network/tx/" + retire["cosmosTx"][:16] + "…",
        "exp_b": "explore.qore.network/tx/" + b["cosmosTx"][:16] + "…",
        "exp_native": "explore.qore.network/tx/" + LOG["exp-native"]["hash"][:16] + "…",
        "docs_url": LOG["docs"]["url"].replace("https://", ""),
        "verify_n": LOG["verifyN"],
    }
    for k, (a, z) in B.items():
        teks["b_%s_a" % k], teks["b_%s_d" % k] = a, round(z - a, 2)
    for k, v in T.items():
        teks["t_" + k] = v
    teks["t_akhir_d"] = round(tempoh - T["akhir"], 2)
    teks["b_tutup_d"] = round(T["akhir"] + .7 - B["tutup"][0], 2)  # the closing lines end under the end card
    # Music bed: the track is shorter than the film, so a second pass fades in under the end of the first.
    musik = 87.6
    teks["bgm1_a"], teks["bgm1_d"] = B["retire"][0], musik
    teks["bgm2_a"] = round(B["retire"][0] + musik - 3, 2)
    teks["bgm2_d"] = round(tempoh - teks["bgm2_a"], 2)
    filem = {
        "_nota": "Generated by video/tangkap/teks.py from evidence/testnet.json, the live capture (video/tangkap/), a real pnpm demo run "
                 "and the voice timings. Change timings there, then run the engine build.",
        "tempoh": tempoh,
        "sari": {"maks_perkataan": 9, "tanpa": []},
        "suara": [{"id": i, "mula": mula[i]} for i, _, _ in ADEGAN],
        "teks": teks,
    }
    with open("video/filem.json", "w", encoding="utf-8") as f:
        json.dump(filem, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("filem.json: %.1f s, %d teks keys, %d demo lines, retire %s" % (tempoh, len(teks), len(VERIFY), retire["cosmosTx"][:12]))


if __name__ == "__main__":
    main()
