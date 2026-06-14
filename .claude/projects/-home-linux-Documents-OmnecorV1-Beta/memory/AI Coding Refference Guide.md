# AI Coding Project Reference Guide

This document outlines the coding best practices and standards to be followed for all AI-assisted coding projects. Adherence to these guidelines ensures code quality, maintainability, efficiency, and security.

## 1. General Principles for AI Agents

*   **Explicit Instructions**: Always prioritize explicit instructions over implicit assumptions. Do not guess; if unsure, ask for clarification.
*   **Contextual Awareness**: Understand the existing codebase, its architecture, and established patterns. Align new code with existing styles and libraries.
*   **Verification is Key**: Rigorously verify all generated code for correctness, efficiency, and security.
*   **Production Standard**: All code must meet production-ready standards, including robustness, scalability, and security.

## 2. Coding Best Practices

### 2.1 Documentation and Readability

*   **Function/Method Documentation**: Every function, method, and significant code block must include clear, concise comments explaining its purpose, parameters, return values, and any non-obvious logic or assumptions. This aids debugging and future upgrades.
*   **Reasoning**: Document the reasoning behind complex or non-standard implementations. Explain *why* a particular approach was chosen.
*   **Code Clarity**: Write self-documenting code where possible. Use meaningful variable and function names.

### 2.2 Code Modularity and Maintainability

*   **Targeted Edits**: When modifying existing code, only edit the specific section that requires changes. Avoid unnecessary refactoring or rewriting of unrelated code.
*   **Modularity**: Promote small, focused functions and classes with clear responsibilities.
*   **Consistency**: Maintain consistent coding style, naming conventions, and architectural patterns throughout the project.

### 2.3 Efficiency and Performance

*   **Algorithm Selection**: Prioritize efficient algorithms (e.g., O(n) over O(n²)) and appropriate data structures, especially for operations that scale with data size.
*   **Resource Management**: Ensure proper cleanup of resources (e.g., closing file handles, database connections) to prevent leaks.
*   **Optimized Operations**: Avoid inefficient patterns like string concatenation within loops. Use optimized methods or libraries for common tasks.

### 2.4 Error Handling and Robustness

*   **Comprehensive Error Handling**: Implement robust error handling for all potential failure points, including edge cases, null values, and boundary conditions.
*   **Avoid Silent Failures**: Never "swallow" exceptions. Log errors appropriately and handle them gracefully to prevent unexpected application behavior or crashes.
*   **Input Validation**: Rigorously validate all inputs to prevent unexpected behavior and security vulnerabilities.
*   ** No Silent Mutations

### 2.5 Security

*   **Secure Coding Practices**: Adhere to secure coding principles to prevent common vulnerabilities.
*   **Parameterized Queries**: Always use parameterized queries or Object-Relational Mappers (ORMs) for database interactions to prevent SQL injection.
*   **Command Injection**: Passing raw user input directly to system commands. Validate, sanitize, and escape all user inputs.
*   **Information Leaks**: Exposing detailed stack traces in error messages. Implement generic error messages for users while logging details securely.
*   **Hallucinated APIs/Libraries**: Do not use or reference non-existent APIs, libraries, or functions. Always verify their existence and correct usage.

## 3. Things to Avoid (Anti-Patterns)

*   **Guessing Solutions**: Do not guess solutions. If uncertain, consult documentation, verified sources, or ask for human clarification.
*   **Blind Trust in Output**: Never deploy generated code without thorough review and testing.
*   **Ignoring Edge Cases**: Do not focus solely on the "happy path." Consider all possible failure scenarios and edge cases.
*   **Unnecessary Rewrites**: Avoid rewriting entire sections of functional code unless there is a clear, documented reason and approval.
*   **Bloated Code**: Do not generate excessive or redundant code. Strive for conciseness and efficiency.
*   **Hardcoding Sensitive Information**: Never hardcode API keys, credentials, or other sensitive data directly in the code.
*   **Ambiguous Instructions**: Avoid vague or unclear instructions when interacting with AI. Provide specific requirements and acceptance criteria.

## 4. Reference and Learning

*   **Consult Manuals**: Refer to official coding manuals, language specifications, and framework documentation.
*   **Verified Sources**: Prioritize information from verified and reputable sources.
*   **Project Guides**: Utilize project-specific style guides, architectural documents, and "gold standard" examples as primary references.
*   **Ask for Clarification**: If a task or requirement is unclear, or if a solution cannot be confidently determined, ask the human developer for guidance. Do not proceed with assumptions.

### 2.6 Path Management

*   **Avoid Hardcoded Paths**: Never hardcode file paths directly within the code. This practice leads to brittle code that is difficult to debug and maintain across different environments.
*   **Centralized Path Configuration**: Utilize a master path import file or a dedicated configuration module to define all project-related file paths. This centralizes path management, allowing for easy updates and ensuring consistency across the entire codebase.
*   **Modular and Debug-Friendly**: Centralized path management enhances code modularity and simplifies debugging, as all path corrections can be made in a single location, avoiding the need to modify multiple files.
