import json
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

model_name = "Qwen/Qwen2.5-3B-Instruct"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype=torch.float16,
    device_map="auto"
)

with open("data/robots_defect_list.json", "r") as f:
    raw_data = json.load(f)

system_prompt = """
You are an expert industrial AI assistant. Your task is to extract defect phrases from messy log entries.
Rules:
1. Fix any speech-to-text typos or slang (e.g., "numatic" -> "pneumatic", "j2" -> "joint 2").
2. Separate combined defects into individual short phrases.
3. Return ONLY a JSON list of clean defect phrases.

Example Input: "j2 motor temp high / axis-3 torque overload"
Example Output: ["joint 2 motor temperature high", "axis 3 torque overload"]
"""

cleaned_defects_list = []

for item in raw_data:
    message = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": item["defectName"]}
    ]

    text = tokenizer.apply_chat_template(
        message,
        tokenize=False,
        add_generated_prompt=True
    )

    model_input = tokenizer(
        [text],
        return_tensors="pt"
    ).to(model.device)

    generated_ids = model.generate(
        **model_input,
        max_new_tokens=128,
    )

    response = tokenizer.decode(
        generated_ids[0][len(model_input.input_ids[0]): ],
        skip_special_tokens=True
    )

    try:
        start = response.find("[")
        if start != -1:
            defects = json.loads(response[start:])
            for d in defects:
                if isinstance(d, list):
                    cleaned_defects_list.extend(d)
                else:
                    cleaned_defects_list.append(d)
        
    except json.JSONDecodeError:
        pass

    print("Cleaned Defects:", cleaned_defects_list)

with open("data/cleaned_defects_list.json", "w") as f:
    json.dump(cleaned_defects_list, f, indent=4)

print("Cleaned defects saved successfully!")