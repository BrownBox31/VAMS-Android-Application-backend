from sentence_transformers import SentenceTransformer
from sentence_transformers import util
import json
from sklearn.cluster import AgglomerativeClustering

with open("data/cleaned_defects_list.json", "r") as f:
    cleaned_defects = json.load(f)

model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

embeddings = model.encode(cleaned_defects, convert_to_tensor=True)

clustering = AgglomerativeClustering(
    metric="cosine",
    linkage="average",
    distance_threshold=0.25,
    n_clusters=None
)

labels = clustering.fit_predict(embeddings.cpu())

groups = {}

for defect, label in zip(cleaned_defects, labels):
    if label not in groups:
        groups[label] = []

    groups[label].append(defect)

with open("grouped_defects.txt", "w") as f:
    group_no = 1

    for group in groups.values():
        if len(group) > 1:
            f.write(f"\nGroup {group_no}\n")
            for defect in group:
                f.write(f" - {defect}\n")

            group_no += 1