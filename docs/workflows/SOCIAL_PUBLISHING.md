# Social Publishing Pipeline

Omnecor features a comprehensive social media publishing pipeline that allows AI agents to directly schedule, curate, and post content to configured social profiles.

## Core Architecture

The system revolves around the `PublishingService` which interacts directly with external social media APIs (e.g., Twitter, LinkedIn, Facebook, Instagram) based on user-provided OAuth tokens. 
Because it interacts with external clouds, it requires non-sovereign execution mode for outbound requests.

### 1. Integration Profiles
- Connected social accounts are managed through `platformAccounts`.
- When querying `listAccounts`, raw tokens are safely omitted from the payload to prevent accidental leakage to the UI or frontend agents.

### 2. Execution Flow
- **Direct Post Creation:** Content is drafted via `createDirectPost` which links curated drafts with scheduled timelines.
- **Publishing Executor:** The `publishNow` method dispatches the payload to the `PublishingService`.
- **API Communication:** The service builds the API request (e.g., `api.twitter.com/2/tweets`) using the decrypted OAuth token.
- **Status Write-back:** If an error occurs (such as a 403 Forbidden or missing token permissions), the pipeline catches the error and writes the status back to the database as `failed` with the exact `errorMessage` from the provider. Honest errors are surfaced to the user rather than failing silently.

## Security
No credentials or OAuth tokens are exposed to the UI. The node-backend `PublishingService` acts as the secure intermediary, executing HTTP requests exclusively on the backend.
