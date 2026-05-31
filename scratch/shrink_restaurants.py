import csv
import os

csv_path = "samples/gumi_restaurants_grouped.csv"
if not os.path.exists(csv_path):
    csv_path = "../samples/gumi_restaurants_grouped.csv"

# Read all rows
rows = []
with open(csv_path, mode='r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    fieldnames = reader.fieldnames
    for row in reader:
        rows.append(row)

print(f"Original size: {len(rows)}")

# Sort spatially by (latitude, longitude) to distribute samples evenly
rows.sort(key=lambda r: (float(r['latitude']), float(r['longitude'])))

# Select every 6th row
shrunk_rows = [rows[i] for i in range(0, len(rows), 6)]
print(f"Shrunk size: {len(shrunk_rows)}")

# Write back to CSV
with open(csv_path, mode='w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(shrunk_rows)

print("CSV shrink completed!")
