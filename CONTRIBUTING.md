# Contributing to Omnecor

We welcome and appreciate contributions to the Omnecor project! By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). This document outlines the guidelines for contributing to Omnecor.

## 1. How to Contribute

There are several ways you can contribute to Omnecor:

-   **Reporting Bugs**: If you find a bug, please open an issue on our GitHub repository. Provide a clear description, steps to reproduce, and expected behavior.
-   **Suggesting Features**: We welcome ideas for new features or improvements. Open an issue to discuss your suggestions.
-   **Submitting Pull Requests**: If you want to contribute code, follow the guidelines below for submitting pull requests.
-   **Improving Documentation**: Help us improve our documentation by clarifying existing content, adding new sections, or fixing typos.

## 2. Setting Up Your Development Environment

To set up your local development environment, follow the [Installation Guide](INSTALL.md) and then proceed with these steps:

1.  **Fork the Repository**: Fork the `Clarkescustomcreations/OmnecorV1-Beta` repository to your GitHub account.
2.  **Clone Your Fork**: Clone your forked repository to your local machine:
    ```bash
    git clone https://github.com/YOUR_USERNAME/OmnecorV1-Beta.git
    cd OmnecorV1-Beta
    ```
3.  **Install Dependencies**: Install all project dependencies using pnpm:
    ```bash
    pnpm install
    ```
4.  **Start Development Server**: Launch the development server:
    ```bash
    pnpm dev
    ```
    This will start both the frontend and backend in development mode.

5.  **Read the Agent Context System** (recommended): Omnecor uses a structured
    context-engineering workflow for both human and AI-assisted contributions.
    Before making non-trivial changes, skim:
    -   [AGENTS.md](AGENTS.md) — behavioral rules, schema gotchas, and the
        mandatory reading order for anyone (human or AI agent) working in this
        codebase.
    -   `Context/Architecture.md`, `Context/Code-Standards.md` — folder
        boundaries, naming, and conventions enforced across the project.
    -   `Context/Progress-Tracker.md` — current phase/feature status, so your
        contribution doesn't collide with in-flight work.
    If you use Claude Code or a similar AI coding agent, these files are
    automatically loaded as project context — keeping them current is itself
    a valuable contribution.

## 3. Pull Request Guidelines

When submitting a pull request, please adhere to the following guidelines:

-   **Branching Strategy**: Create a new branch for your feature or bug fix. Use a descriptive branch name (e.g., `feature/add-new-module` or `bugfix/fix-login-issue`).
-   **Coding Standards**: Follow the existing coding style and conventions used in the project. Ensure your code is clean, readable, and well-commented.
-   **Commit Messages**: Write clear and concise commit messages. A good commit message explains *what* was changed and *why*.
-   **Testing**: If applicable, add unit or integration tests for your changes. Ensure all existing tests pass.
-   **Documentation**: Update relevant documentation (e.g., `README.md`, `CHANGELOG.md`, or specific `docs/` files) to reflect your changes.
-   **One Feature/Bug Per PR**: Each pull request should address a single feature or bug fix to keep changes focused and easier to review.
-   **Rebase Before Merging**: Rebase your branch on top of the latest `main` branch before submitting your pull request to avoid merge conflicts.

## 4. Code Style

Omnecor uses `prettier` for code formatting. Before submitting your pull request, ensure your code is formatted correctly by running:

```bash
pnpm run format
```

## 5. Testing

Omnecor uses `vitest` for testing. You can run the tests with:

```bash
pnpm run test
```

Ensure all tests pass before submitting your pull request.

## 6. Issue Triage

If you are triaging issues, please ensure:

-   The issue is clearly described.
-   Steps to reproduce are provided (if applicable).
-   Relevant labels are applied.
-   Duplicate issues are closed and linked to the original.

Thank you for contributing to Omnecor!
