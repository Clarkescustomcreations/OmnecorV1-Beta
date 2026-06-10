# Valet-V1 — frozen checkpoint (2026-06-09)

First Valet router that **beats the keyword baseline**. Frozen as a known-good
rollback point before further tuning.

## What this is
- LoRA adapter for `Qwen/Qwen2.5-1.5B-Instruct`, trained on Kaggle free GPU.
- Config: `max_seq_length=3072`, fp16 (no 4-bit), LoRA r=8 / alpha=16, 1.5 epochs,
  2,410 training examples. See `train_config.json`.
- The fix vs. the 14% runs: trained at seq 3072 so the model actually sees the
  answer (answers start ~token 2027; local 512 cap truncated them).

## Eval scores (430 examples)
**TRUE score (corrected eval): overall 78.4%, route 80.8%, baseline 27.4% → beats baseline.**
The original `eval_kaggle.log` showed 46.7% but that was an EVAL ARTIFACT (220-token
cap truncating valid JSON + withheld RAG context). Corrected run:
`../eval_v1_corrected.log`. Confidence mean 0.93. 6.6 pts under the 85% gate.
- 100%: code_generation, local_task, rules, hardware, knowledge_retrieval. 97% context_mgmt, 90% qa, 80% memory_ops, 77% synthesis, 73% media_gen/integration/reporting, 70% research.
- **Real V2 targets (weak, not eval): skill 0%, plan 30%, code_review 53%, instruction_writing 53%.**
- Known model issue: JSON sometimes verbose/slightly malformed → fix via cleaner training targets (production-parse risk).

## Files
- `adapter_config.json` + `adapter_model.safetensors` — the LoRA adapter
- tokenizer files (`tokenizer.json`, `merges.txt`, `vocab.json`, …)
- `train_config.json` — training hyperparameters
- `eval_kaggle.log` — full eval output incl. per-bucket + confusion matrix
- `valet_train_kaggle.py` — exact kernel that produced this
- `train.snapshot.jsonl` — the exact training data used (2,410 examples)

## Restore / evaluate
```
# point the eval at this folder
python server/python_bridges/valet_eval.py --artifact-dir tmp-valet-train/Valet-V1

# or register it as the active Valet artifact (via trainingRouter.registerArtifact)
#   artifactPath = tmp-valet-train/Valet-V1, format = "lora",
#   baseModel = Qwen/Qwen2.5-1.5B-Instruct
```

Do not overwrite this folder. Future experiments go in new dirs; this stays the
backup. Older Phase-1 model preserved separately at `tmp-valet-train/valley1/`.
