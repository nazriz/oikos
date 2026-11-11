"""Candidate 3's edit, made though the probe said the information is not there (to measure what the simplest edit
trades): the head's refusals (none:*) raised by DELTA in logits. They are allowed only at the first decision, so
nothing else moves. DELTA was chosen on the small models' diagnosing half (kind_bias.py: 4 refuses 5 more of its 22
refusal keys and no act key there).
  uv run --project translator/model/py python translator/model/wsp/edit_refusal_bias.py [DELTA] [OUT_DIR]
Writes OUT_DIR/<name>/ (config, encoder, edited weights, and this script beside them)."""
import json, shutil, sys
from pathlib import Path
from safetensors.torch import load_file, save_file

SERVED = Path("/Users/clawd/oikos/runs/translator-v4-r3-2026-11-08/models/v4r3-D-deberta-s2")
delta = float(sys.argv[1]) if len(sys.argv) > 1 else 4.0
out = Path(sys.argv[2] if len(sys.argv) > 2 else "/Users/clawd/oikos/runs/translator-weight-edit-2026-11-11/models") / f"wsp-refusal-bias{delta:g}"
cfg = json.loads((SERVED / "config.json").read_text())
choices = cfg["vocabulary"] + ["<id>", "<text>", "<word>", "<field>"]
w = load_file(str(SERVED / "model.safetensors"))
idx = [i for i, c in enumerate(choices) if c.startswith("none:")]
w["choose.bias"] = w["choose.bias"].clone()
w["choose.bias"][idx] += delta
out.mkdir(parents=True, exist_ok=True)
save_file(w, str(out / "model.safetensors"))
shutil.copy(SERVED / "config.json", out / "config.json")
shutil.copytree(SERVED / "encoder", out / "encoder", dirs_exist_ok=True)
shutil.copy(__file__, out / Path(__file__).name)
print("edited", [choices[i] for i in idx], "by", delta, "->", out)
