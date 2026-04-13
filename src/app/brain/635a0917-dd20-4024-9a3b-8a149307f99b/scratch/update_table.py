
import os

filepath = r'c:\Users\hp\Desktop\accountant\src\app\page.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    new_lines.append(line)
    if '<th className="px-6 py-3">Sales (Month)</th>' in line:
        indent = line[:line.find('<th')]
        new_lines.append(f'{indent}<th className="px-6 py-3">Purchases (Total)</th>\n')
    if '<td className="px-6 py-4 font-mono text-emerald-600">₹{m.sales.toLocaleString()}</td>' in line:
        indent = line[:line.find('<td')]
        new_lines.append(f'{indent}<td className="px-6 py-4 font-mono text-amber-600">₹{{m.purchases.toLocaleString()}}</td>\n')

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Updates successful")
