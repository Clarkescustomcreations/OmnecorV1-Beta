# Penpot Bridge

The **Penpot Bridge** integrates the open-source Penpot design tool directly into Omnecor's frontend generation capabilities. 

## Overview
Powered by the `PenpotService.ts` headless bridge and exposed via the `penpotRouter.ts`, the system can authenticate, fetch, and parse Penpot design files, reading raw design tokens (colors, typography, spacing).

## Capabilities
1. **Design Token Ingestion**: Dynamically pulls OkLCH colors, spacing, and typographic properties directly from Penpot libraries.
2. **Component Generation**: Allows Omnecor's UI building agents to generate React components that perfectly match the Penpot source-of-truth.
3. **Headless Bridge**: Operates entirely server-side, meaning no CORS issues or browser limits apply to fetching design boards.

## Security
The `PenpotService` runs within the protected server backend. All file path traversals for caching or saving assets use the central `validatePath` security guard to prevent directory traversal attacks.
