# ConsultBae Candidate Ingestion & Audio Collection App

This repository contains the complete implementation for the ConsultBae Candidate Ingestion Pipeline, n8n Duplicate Checker Automation, and the Speech Audio Collection Web App.

---

## Setup & Installation

### 1. Ingestion Pipeline (Task 1)
To run the database ingestion pipeline:
```bash
# Navigate to the project root and run
node task1_merge/merge_pipeline.js
```
*This will read `source1_naukri.json`, `source2_gig_workers.csv`, and `source3_cbnexus.xlsx`, merge duplicate records, and create/populate `consultbae.db`.*

To view the database records in your terminal:
```bash
node task1_merge/view_data.js
# Or to view details of a specific candidate by database ID (e.g. ID 18)
node task1_merge/view_data.js 18
```

### 2. Duplicate Check Automation (Task 2)
1. Start the database bridge server:
   ```bash
   node task2_automation/task2_database.js
   ```
2. Open your local n8n browser editor (`http://localhost:5678`).
3. Import the **`task2_automation/workflow.json`** file.
4. Trigger the workflow by uploading the CSV file:
   ```bash
   curl -X POST -F "data=@source2_gig_workers.csv" http://localhost:5678/webhook-test/new-candidate
   ```
5. You will see duplicate alerts print live inside the bridge server terminal and log into **`task2_automation/duplicate_alerts.json`**.

### 3. Audio Collection App (Task 3)


1. Start the Express server:
   ```bash
   node task3_audio_app/server.js
   ```
2. Open your browser and go to: **`http://localhost:3000`**
3. Upload or record audio, fill in candidate details, and submit. The submissions log at the bottom will update in real-time.

---

## Data Quality Issues Report (Task 4)

During the data ingestion phase, several significant anomalies were identified across the three source files:
1. **Column Shifts / Malformed Rows**: In `source2_gig_workers.csv`, row 20 (Isha Chopra) has its columns shifted to the left because the `skills` column contains unescaped commas. This resulted in the name shifting into the email slot.
2. **Phone Formatting Discrepancies**: Phone numbers were formatted inconsistently across files (some had `+91` prefix, some started with `0`, others had spaces like `+91 90000 00113`).
3. **City Name Inconsistency**: Cities were spelled differently across platforms (e.g. `"Gurgaon"` vs `"Gurugram"`, lowercase `"noida"` vs `"Noida"`).
4. **Deduplication Identity Gaps**: There was no common unique identifier (like an ID) across the three systems. Candidates had to be matched using logic: identical emails, identical cleaned phone numbers, or identical name + standardized city.

---

## Stuck Log (Task 5)

### 1. n8n SQLite Node Restriction
* **The Problem**: n8n 1.0+ has removed native support for file-based SQLite databases. The standard n8n database node could not connect to `consultbae.db` directly.
* **How I got unstuck**: I built a lightweight Express bridge server in Node.js (`task2_database.js`) running on port `5001` that exposes the SQLite database over local HTTP endpoints (`/check-duplicate-bulk` and `/alert`). n8n calls this bridge using a standard HTTP Request node.
* **Rejected Suggestions**: I rejected executing raw `sqlite3` commands inside n8n via shell execution nodes, as this requires complex environment permissions and makes the n8n flow messy.

### 2. CSV Column Shifting Anomaly (Isha Chopra)
* **The Problem**: Hardcoding fixed indices to extract Name, Email, and Phone failed because row 20 in the CSV had its fields shifted.
* **How I got unstuck**: I wrote a content-based dynamic field aligner (`alignCandidateFields`). It loops through all values of the candidate object and classifies them by content: values containing `@` become Email, 10-12 digit numbers become Phone, known city keywords become City, and the remaining text becomes Name.
* **Rejected Suggestions**: I rejected hardcoding `if (row === 20)` because this fix would break immediately if a different row shifted in a future file.


