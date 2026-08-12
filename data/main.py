import os
import sys
import json
import subprocess
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="VAMS Python Defect Analyzer API", version="1.0.0")

# Enable CORS for frontend and main backend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DEFECTS_PATH = os.path.join(DATA_DIR, "data", "robots_defect_list.json")
CLEANED_DEFECTS_PATH = os.path.join(DATA_DIR, "data", "cleaned_defects_list.json")
GROUPED_DEFECTS_PATH = os.path.join(DATA_DIR, "grouped_defects.txt")

# State tracking for running tasks
task_status = {
    "cleaner": {"status": "idle", "error": None},
    "clustering": {"status": "idle", "error": None}
}

class StatusResponse(BaseModel):
    status: str
    error: str = None

def run_script_task(script_name: str, task_key: str):
    task_status[task_key]["status"] = "running"
    task_status[task_key]["error"] = None
    try:
        script_path = os.path.join(DATA_DIR, script_name)
        result = subprocess.run(
            [sys.executable, script_path],
            cwd=DATA_DIR,
            capture_output=True,
            text=True,
            check=True
        )
        task_status[task_key]["status"] = "success"
    except subprocess.CalledProcessError as e:
        task_status[task_key]["status"] = "failed"
        task_status[task_key]["error"] = f"Exit code {e.returncode}. Stderr: {e.stderr}"
    except Exception as e:
        task_status[task_key]["status"] = "failed"
        task_status[task_key]["error"] = str(e)

def parse_grouped_defects(filepath):
    groups = []
    current_group = None
    if not os.path.exists(filepath):
        return groups
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                if line.startswith("Group "):
                    group_no = line.split(" ")[1]
                    current_group = {"group": int(group_no) if group_no.isdigit() else group_no, "defects": []}
                    groups.append(current_group)
                elif line.startswith("-") and current_group is not None:
                    defect = line[1:].strip()
                    current_group["defects"].append(defect)
    except Exception as e:
        print(f"Error parsing grouped defects file: {e}")
    return groups

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "python_version": sys.version}

@app.get("/api/raw-defects")
def get_raw_defects():
    if not os.path.exists(RAW_DEFECTS_PATH):
        raise HTTPException(status_code=404, detail="Raw defects log file not found.")
    try:
        with open(RAW_DEFECTS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read raw defects: {str(e)}")

@app.get("/api/cleaned-defects")
def get_cleaned_defects():
    if not os.path.exists(CLEANED_DEFECTS_PATH):
        raise HTTPException(status_code=404, detail="Cleaned defects dictionary file not found.")
    try:
        with open(CLEANED_DEFECTS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read cleaned defects: {str(e)}")

@app.get("/api/grouped-defects")
def get_grouped_defects():
    if not os.path.exists(GROUPED_DEFECTS_PATH):
        # Return empty list or parsed file list
        return []
    return parse_grouped_defects(GROUPED_DEFECTS_PATH)

@app.get("/api/tasks/status")
def get_tasks_status():
    return task_status

@app.post("/api/run-cleaner")
def run_cleaner(background_tasks: BackgroundTasks):
    if task_status["cleaner"]["status"] == "running":
        return {"message": "Cleaner is already running."}
    background_tasks.add_task(run_script_task, "qwen_cleaner.py", "cleaner")
    return {"message": "Defect text cleaner (Qwen) started in background."}

@app.post("/api/run-similarity")
def run_similarity(background_tasks: BackgroundTasks):
    if task_status["clustering"]["status"] == "running":
        return {"message": "Clustering is already running."}
    background_tasks.add_task(run_script_task, "defect_similarity.py", "clustering")
    return {"message": "Defect similarity clustering (Sentence Transformers) started in background."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
