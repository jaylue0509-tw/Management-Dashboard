import pandas as pd
import json

file_path = r"C:\Users\Jay\Management Dashboard\DATA\東寵門市 巡店紀錄表－回覆資料.xlsx"

df = pd.read_excel(file_path)

output = {
    "columns": list(df.columns),
    "first_row": df.iloc[0].to_dict() if not df.empty else None
}

# handle NaN and NaT
def default_converter(o):
    import numpy as np
    if pd.isna(o):
        return None
    if isinstance(o, (pd.Timestamp, pd.Timedelta)):
        return str(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    return str(o)

with open(r"C:\Users\Jay\Management Dashboard\scratch\inspect_output.json", "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2, default=default_converter)
