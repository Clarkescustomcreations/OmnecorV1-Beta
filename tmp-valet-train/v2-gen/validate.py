#!/usr/bin/env python3
import json
import sys

def validate_jsonl(filepath, expected_category):
    """Validate JSONL file for JSON parsing and structure."""
    line_count = 0
    valid_lines = 0
    errors = []

    with open(filepath, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line_count += 1
            line = line.rstrip('\n')

            # Parse outer JSON
            try:
                row = json.loads(line)
            except json.JSONDecodeError as e:
                errors.append(f"Line {line_num}: Invalid JSON - {e}")
                continue

            # Validate required keys
            required_keys = {"task_class", "instruction", "input", "execution_mode", "available_providers", "output"}
            if not all(k in row for k in required_keys):
                errors.append(f"Line {line_num}: Missing required keys")
                continue

            # Validate output is a JSON string and parse it
            try:
                output_obj = json.loads(row["output"])
            except json.JSONDecodeError as e:
                errors.append(f"Line {line_num}: Invalid nested output JSON - {e}")
                continue

            # Validate output object structure
            required_output_keys = {
                "category", "mode", "primary_provider", "primary_model",
                "secondary_providers", "cost_tier", "local_capable",
                "confidence", "requires_todo_md", "requires_status_md", "reasoning"
            }
            if not all(k in output_obj for k in required_output_keys):
                errors.append(f"Line {line_num}: Missing output keys - has {set(output_obj.keys())}")
                continue

            # Validate category matches expected
            if output_obj["category"] != expected_category:
                errors.append(f"Line {line_num}: Wrong category '{output_obj['category']}', expected '{expected_category}'")
                continue

            # Validate confidence is between 0.82 and 0.97
            if not (0.82 <= output_obj["confidence"] <= 0.97):
                errors.append(f"Line {line_num}: Confidence {output_obj['confidence']} out of range [0.82, 0.97]")
                continue

            valid_lines += 1

    return {
        "filepath": filepath,
        "total_lines": line_count,
        "valid_lines": valid_lines,
        "errors": errors,
        "success": len(errors) == 0 and line_count > 0
    }

# Validate both files
results = []

# code_review.jsonl
code_review_result = validate_jsonl(
    r"c:\Claude-Code\OmnecorV1-Beta-main\OmnecorV1-Beta-main\tmp-valet-train\v2-gen\code_review.jsonl",
    "code_review"
)
results.append(code_review_result)

# instruction_writing.jsonl
instruction_result = validate_jsonl(
    r"c:\Claude-Code\OmnecorV1-Beta-main\OmnecorV1-Beta-main\tmp-valet-train\v2-gen\instruction_writing.jsonl",
    "instruction_writing"
)
results.append(instruction_result)

# Report results
print("=" * 70)
print("VALET FINE-TUNING DATA VALIDATION REPORT")
print("=" * 70)

for result in results:
    print(f"\nFile: {result['filepath'].split(chr(92))[-1]}")
    print(f"Total Lines: {result['total_lines']}")
    print(f"Valid Lines: {result['valid_lines']}")

    if result['errors']:
        print(f"Errors Found: {len(result['errors'])}")
        for error in result['errors'][:10]:  # Show first 10 errors
            print(f"  - {error}")
        if len(result['errors']) > 10:
            print(f"  ... and {len(result['errors']) - 10} more errors")
    else:
        print("Status: VALID")

    if result['total_lines'] == 150 and result['valid_lines'] == 150:
        print("Result: PASS (150/150 lines valid)")
    else:
        print(f"Result: FAIL ({result['valid_lines']}/150 lines valid)")

print("\n" + "=" * 70)
all_success = all(r['success'] and r['total_lines'] == 150 for r in results)
print(f"Overall Result: {'ALL TESTS PASSED' if all_success else 'TESTS FAILED'}")
print("=" * 70)
