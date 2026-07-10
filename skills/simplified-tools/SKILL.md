---
name: mcp-simplified-tools
description: Use this skill to leverage the Simplified Tools MCP server, providing smaller AI models with easy-to-use, syntax-error-free wrappers for common terminal and file operations.
---

# MCP Simplified Tools

This skill describes the `Simplified Tools` MCP server available in the Omnecor environment. It provides highly simplified tool wrappers for common file and terminal operations.

## Why use this?
Smaller, local AI models often struggle with complex bash syntax, regex escaping in `sed`, or tricky `cat EOF` blocks. This MCP server abstracts those operations into simple JSON schemas that guarantee correct execution without escaping nightmares.

## Available Tools

1. **`easy_write_file`**
   - **Use case:** Creating or completely overwriting a file with a block of text.
   - **Arguments:** `path` (absolute path), `content` (the exact text to write).
   - **Why it's better:** No need to escape quotes or manage `echo >` syntax in a terminal.

2. **`easy_append_file`**
   - **Use case:** Adding text to the bottom of an existing file.
   - **Arguments:** `path` (absolute path), `content` (the text to append).
   - **Why it's better:** No `echo >>` escaping issues.

3. **`easy_replace_text`**
   - **Use case:** Replacing a specific string in a file without regex.
   - **Arguments:** `path` (absolute path), `old_text` (exact string to find), `new_text` (exact string to substitute).
   - **Why it's better:** Avoids `sed` delimiter conflicts (like replacing URLs with `/` in them) and regex syntax errors.

4. **`easy_read_lines`**
   - **Use case:** Reading a specific chunk of a file.
   - **Arguments:** `path` (absolute path), `start_line` (1-indexed), `end_line` (inclusive).
   - **Why it's better:** Avoids tricky `head -n | tail -n` math.

5. **`easy_list_directory`**
   - **Use case:** Getting a clean, formatted list of files and folders in a directory.
   - **Arguments:** `directory` (absolute path).
   - **Why it's better:** Standardized output format indicating `[DIR ]` vs `[FILE]`.

## Usage Guidelines for Small Models
- Always prefer these tools over `run_command` with bash scripts when doing simple file edits.
- Use `easy_replace_text` for updating settings or replacing variable values without writing complex regex.
- When you need to create a new module, use `easy_write_file` to scaffold it safely.
