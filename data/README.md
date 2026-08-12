# Alert System App

## Overview

This project automatically groups similar industrial robot defect descriptions using Large Language Models (LLMs) and Sentence Transformers.

The system first cleans and standardizes raw defect descriptions using Qwen 2.5-3B-Instruct. It then generates semantic embeddings using MiniLM and groups similar defects using Agglomerative Clustering.

---

## Features

- Clean noisy defect descriptions
- Standardize similar defect messages
- Generate sentence embeddings
- Cluster semantically similar defects
- Save grouped defects into a text file

---

## Project Structure

```
.
├── data
│   ├── robots_defect_list.json
│   └── cleaned_defects_list.json
├── defect_similarity.py
├── grouped_defects.txt
├── qwen_cleaner.py
├── requirements.txt
└── README.md
```

---

## Technologies Used

- Python
- Qwen 2.5-3B-Instruct
- Sentence Transformers
- all-MiniLM-L6-v2
- Scikit-learn

---

## Workflow

1. Read raw defect descriptions.
2. Clean and standardize defects using Qwen.
3. Generate semantic embeddings using MiniLM.
4. Group similar defects using Agglomerative Clustering.
5. Save grouped defects into `grouped_defects.txt`.

---

## Installation

Clone the repository:

```bash
git clone <repository-url>
```

Move into the project folder:

```bash
cd Alert-System-App
```

Install dependencies:

```bash
pip install -r requirements.txt
```

---

## Run

### Step 1: Clean defect descriptions

```bash
python qwen_cleaner.py
```

### Step 2: Group similar defects

```bash
python defect_similarity.py
```

---

## Input

```
data/robots_defect_list.json
```

---

## Output

Cleaned defects:

```
data/cleaned_defects_list.json
```

Grouped defects:

```
grouped_defects.txt
```

---

## Example Output

```
Group 1
- robotic arm joint 2 servo motor overheating
- joint 2 servo overheat
- joint 2 servo motor overheat ERR-8021

Group 2
- axis 3 torque limit exceeded
- axis 3 torque overload
- axis 3 high torque resistance
```

---

## Author

Viraj Garware