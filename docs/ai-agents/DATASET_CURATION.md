# LLM Builder Dataset Discovery & Curation

Omnecor features a comprehensive Dataset Curation pipeline designed to rapidly build, review, and compile fine-tuning datasets (in JSONL format) for local models via the Unsloth panel.

## Architecture

The pipeline consists of the `datasetRouter.ts` on the backend and the `DatasetCurationPanel.tsx` React component on the frontend.

### 1. Discovery & Scraping
- **Local BFS Folder Scanning**: The system can crawl designated local directories on the host, scanning for relevant text or code files to ingest as training data.
- **Search Query Web-Scraping**: Supports executing search queries to discover and scrape external documentation or articles directly into the dataset queue.

### 2. Interactive Review Queue
- The frontend exposes a tabbed layout inside the `UnslothPanel` featuring an interactive review queue.
- Users can step through scraped or scanned data points and perform three actions:
  - **Approve**: Move the item to the curated dataset.
  - **Edit**: Modify the prompt/response pairing before approval.
  - **Reject**: Discard the noisy or irrelevant item.

### 3. Compilation
- Once curation is complete, `datasetRouter.compileDataset` builds the final structured JSONL output.
- The compiled path is automatically supplied back to the Unsloth fine-tuning form, allowing a seamless transition from data gathering to model training.
