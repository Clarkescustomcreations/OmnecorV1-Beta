@echo off
REM valet-train-worker.bat — Windows rank-1 worker launcher
REM Run this on the Windows machine (GTX 950, 4GB) BEFORE starting the Linux master.
REM
REM Prerequisites on Windows:
REM   1. Python 3.11 installed and on PATH
REM   2. pip install torch --index-url https://download.pytorch.org/whl/cu118
REM   3. pip install transformers datasets accelerate trl peft bitsandbytes
REM   4. Dataset copied to DATASET_PATH below (or map a network share)
REM   5. Copy localLLMfine-tuning-qlora.py to this machine
REM
REM Network share option (map Linux share as Z: drive):
REM   net use Z: \\192.168.1.252\omnecor /persistent:no
REM   Then set DATASET_PATH=Z:\data\valet\train.jsonl

set MASTER_ADDR=192.168.1.252
set MASTER_PORT=29500
set DATASET_PATH=C:\omnecor\data\valet\train.jsonl
set SCRIPT_PATH=C:\omnecor\tmp-valet-train\localLLMfine-tuning-qlora.py
set OUTPUT_PATH=C:\omnecor\tmp-valet-train\outputs

echo [worker] Starting rank-1 worker, connecting to master at %MASTER_ADDR%:%MASTER_PORT%
echo [worker] Dataset: %DATASET_PATH%

torchrun ^
    --nproc_per_node=1 ^
    --nnodes=2 ^
    --node_rank=1 ^
    --master_addr=%MASTER_ADDR% ^
    --master_port=%MASTER_PORT% ^
    %SCRIPT_PATH% ^
    --dataset_path %DATASET_PATH% ^
    --output_dir %OUTPUT_PATH% ^
    --save_method lora ^
    --epochs 3

pause
