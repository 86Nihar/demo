
import os

filepath = r'c:\Users\hp\Desktop\accountant\src\app\page.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    new_lines.append(line)
    if '<h2 className="font-bold text-lg">Inventory Products</h2>' in line:
        indent = line[:line.find('<h2')]
        new_lines.append(f'{indent}<div className="bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1 rounded-lg border border-emerald-100 dark:border-emerald-800">\n')
        new_lines.append(f'{indent}   <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 block">Total Active Stock Value</span>\n')
        new_lines.append(f'{indent}   <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300 font-mono">₹{{parsedData.totalProductStockPrice.toLocaleString()}}</span>\n')
        new_lines.append(f'{indent}</div>\n')

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Inventory header updated successfully")
