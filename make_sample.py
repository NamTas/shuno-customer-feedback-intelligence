"""Cuts a huge review CSV down to a random sample.
Usage: python make_sample.py Reviews.csv reviews_5000.csv 5000
"""
import csv
import random
import sys

source, target = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 5000
csv.field_size_limit(10**8)
random.seed(1)

with open(source, newline="", encoding="utf-8") as file:
    reader = csv.reader(file)
    header = next(reader)
    sample = []
    for i, row in enumerate(reader):  # reservoir sampling: needs very little memory
        if i < size:
            sample.append(row)
        elif (j := random.randint(0, i)) < size:
            sample[j] = row

with open(target, "w", newline="", encoding="utf-8") as file:
    writer = csv.writer(file)
    writer.writerow(header)
    writer.writerows(sample)
print(f"Saved {len(sample)} reviews to {target}")
