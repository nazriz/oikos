"""How many tokens of a trained model's reader a text is (scripts/forms-inventory.ts): the same count the model's own
loader makes (tokens.py `tokenize`: special tokens added, nothing cut). Reads {"texts": [...]} on stdin, writes
{"tokens": [...]}. Usage: python count_tokens.py <the model's encoder folder>. No model is run; only its tokenizer."""
import json
import sys

from transformers import AutoTokenizer


def main() -> None:
    tokenizer = AutoTokenizer.from_pretrained(sys.argv[1])
    texts = json.load(sys.stdin)["texts"]
    print(json.dumps({"tokens": [len(tokenizer(t, add_special_tokens=True, truncation=False, verbose=False)["input_ids"]) for t in texts]}))


if __name__ == "__main__":
    main()
