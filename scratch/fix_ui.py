
import os

file_path = r'c:\Users\hp\Desktop\Biling software\BASICPROFITLOSS\src\app\page.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
skip = False
for i, line in enumerate(lines):
    # Detect the broken area
    if 'No payment records' in line and '</span>' in lines[i+1] and '</div>' in lines[i+2] and '</td>' in lines[i+3]:
        new_lines.append(line)
        new_lines.append(lines[i+1])
        new_lines.append(lines[i+2])
        new_lines.append(lines[i+3])
        
        # Now insert the missing / upgraded part
        new_lines.append('                        <td className="px-6 py-4 text-right align-top pt-5">\n')
        new_lines.append('                          <div className="flex flex-col items-end gap-2">\n')
        new_lines.append('                            <span className={`px-2 py-0.5 rounded flex items-center gap-1 text-[10px] font-bold uppercase tracking-tight shadow-sm border ${\n')
        new_lines.append("                              tx.paymentStatus === 'Paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800' : \n")
        new_lines.append("                              tx.paymentStatus === 'Partial' ? 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:border-amber-800' : \n")
        new_lines.append("                              'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-900/20 dark:border-rose-800'\n")
        new_lines.append('                            }`}>\n')
        new_lines.append("                              <i className={tx.paymentStatus === 'Paid' ? 'ri-checkbox-circle-fill' : tx.paymentStatus === 'Partial' ? 'ri-time-fill' : 'ri-close-circle-fill'}></i> {tx.paymentStatus}\n")
        new_lines.append('                            </span>\n')
        new_lines.append('                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">\n')
        
        # Skip the broken lines until we reach the next button
        # The broken lines are likely the empty line and the partial div
        # We start skipping from lines[i+4]
        # We stop skipping when we find the View button
        skip = True
        continue
    
    if skip:
        if 'handleView(tx)' in line:
            # We found the button, stop skipping but we want to replace this button too!
            new_lines.append('                               <button onClick={() => handleView(tx)} className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer font-bold bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg transition-all border border-slate-200 dark:border-slate-700 hover:border-indigo-200 shadow-sm">\n')
            new_lines.append('                                 <i className="ri-eye-line text-sm"></i> View\n')
            new_lines.append('                               </button>\n')
            skip = False
            # Also skip the original button lines
            # (original button is 3 lines)
            continue 
    
    if not skip:
        # Check for other buttons to replace
        if 'exportInvoice(tx, \'Invoice\')' in line:
            new_lines.append('                                   <button onClick={() => exportInvoice(tx, \'Invoice\')} className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-white hover:bg-indigo-600 cursor-pointer font-bold border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded-lg transition-all shadow-sm">\n')
            new_lines.append('                                     <i className="ri-file-paper-line text-sm"></i> Invoice\n')
            new_lines.append('                                   </button>\n')
            # Need to skip the next few lines of the old button
            # Old button:
            # <button ...>
            #   Tax Invoice
            # </button>
            # But wait, it's easier to just detect and replace the whole block
            continue
        
        # To keep it simple, I'll just replace the most common strings
        line = line.replace("👁️ View", '<i className="ri-eye-line text-sm"></i> View')
        line = line.replace("Edit", '<i className="ri-edit-line text-sm"></i> Edit')
        line = line.replace("Delete", '<i className="ri-delete-bin-line text-sm"></i> Delete')
        
        # Actually, let's just do a thorough replacement for the action buttons
        if 'openEditModal(tx)' in line:
             new_lines.append('                               <button onClick={() => openEditModal(tx)} className="flex items-center gap-1 text-[11px] text-amber-600 hover:text-white hover:bg-amber-600 cursor-pointer font-bold border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-lg transition-all shadow-sm">\n')
             new_lines.append('                                 <i className="ri-edit-line text-sm"></i> Edit\n')
             new_lines.append('                               </button>\n')
             continue

        if 'deleteTx(tx.id)' in line:
             new_lines.append('                               <button onClick={() => deleteTx(tx.id)} className="flex items-center gap-1 text-[11px] text-rose-600 hover:text-white hover:bg-rose-600 cursor-pointer font-bold border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded-lg transition-all shadow-sm">\n')
             new_lines.append('                                 <i className="ri-delete-bin-line text-sm"></i> Delete\n')
             new_lines.append('                               </button>\n')
             continue

        new_lines.append(line)

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
