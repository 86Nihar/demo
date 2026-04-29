
import os

file_path = r'c:\Users\hp\Desktop\Biling software\BASICPROFITLOSS\src\app\page.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Restore the Monthly History table body
monthly_body_broken = content.find('<tbody className="divide-y divide-slate-100 dark:divide-slate-800">', content.find('📅 Monthly Financial History'))
if monthly_body_broken != -1:
    end_of_broken = content.find('</tbody>', monthly_body_broken)
    if end_of_broken != -1:
        correct_monthly_body = """<tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                         {parsedData.monthlyData.map((m, idx) => (
                           <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors group">
                              <td className="px-6 py-4 font-bold text-slate-700 dark:text-slate-300">
                                {new Date(m.month + '-02').toLocaleString('default', { month: 'long', year: 'numeric' })}
                              </td>
                              <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-400">₹{m.opening.toLocaleString()}</td>
                              <td className="px-6 py-4 font-mono text-emerald-600">₹{m.sales.toLocaleString()}</td>
                              <td className="px-6 py-4 font-mono text-amber-600">₹{m.purchases.toLocaleString()}</td>
                              <td className="px-6 py-4 font-mono text-amber-600">₹{m.profit.toLocaleString()}</td>
                              <td className="px-6 py-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">₹{m.closing.toLocaleString()}</td>
                              <td className={`px-6 py-4 font-bold ${m.closing - m.opening >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {m.closing - m.opening >= 0 ? '+' : ''}₹{(m.closing - m.opening).toLocaleString()}
                              </td>
                           </tr>
                         ))}
                      </tbody>"""
        content = content[:monthly_body_broken] + correct_monthly_body + content[end_of_broken+len('</tbody>'):]

# 2. Fix the main transaction table body
main_ledger_anchor = content.find('Main Activity Ledger')
if main_ledger_anchor == -1:
    main_ledger_anchor = content.find('Dashboard\' : `${activeTab} Records`}')

main_body_start = content.find('<tbody className="divide-y divide-slate-100 dark:divide-slate-800">', main_ledger_anchor)
if main_body_start != -1:
    main_body_end = content.find('</tbody>', main_body_start)
    if main_body_end != -1:
        new_main_body = """<tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {displayList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-500">
                        No records found. Click &quot;+ SALE&quot; or &quot;+ PURCHASE&quot; to add one.
                      </td>
                    </tr>
                  ) : (
                    displayList.map((tx, idx) => (
                      <tr key={tx.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors group border-b border-slate-50 dark:border-slate-800/50 last:border-0">
                        <td className="px-6 py-4 align-top">
                          <div className="flex flex-col pt-1">
                            <span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{idx + 1}</span>
                            <span className="text-[11px] text-slate-500 font-medium">{tx.date}</span>
                            <span className={`mt-2 text-[10px] w-max px-2 py-0.5 rounded font-bold uppercase tracking-tight shadow-sm border ${tx.type === 'Sale' ? 'bg-indigo-50 text-indigo-700 border-indigo-100 dark:bg-indigo-900/40 dark:text-indigo-400' : 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-400'}`}>
                              {tx.type}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top">
                          <div className="flex flex-col gap-2">
                             <div className="flex items-center gap-2">
                               {tx.partyName && tx.partyName.toLowerCase() !== 'general' && tx.partyName !== '-' && (
                                 <span className="font-bold text-xs text-slate-700 dark:text-slate-300 uppercase tracking-tight">{tx.partyName}</span>
                               )}
                               <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[10px] text-slate-500 lowercase font-bold border border-slate-200 dark:border-slate-700 uppercase">{getTxItems(tx).length} item(s)</span>
                             </div>
                             <div className="flex flex-col gap-2 border-l-2 border-slate-100 dark:border-slate-800 pl-3 py-1">
                               {getTxItems(tx).map((it, idx) => (
                                 <div key={idx} className="flex flex-col whitespace-normal min-w-[200px]">
                                   <span className="font-bold text-sm leading-tight text-slate-800 dark:text-slate-100">{it.productName}</span>
                                   <span className="text-[11px] font-mono text-slate-400 mt-0.5 tracking-tighter">IMEI: {it.imeiNo}</span>
                                 </div>
                               ))}
                             </div>
                             {(tx.remark || tx.gift) && (
                               <div className="mt-1 flex flex-col gap-1 max-w-[300px]">
                                 {tx.gift && <span className="text-[11px] flex items-center gap-1 text-pink-600 bg-pink-50 dark:bg-pink-900/20 px-2 py-0.5 rounded-md max-w-max whitespace-normal break-words font-bold border border-pink-100 dark:border-pink-800"><i className="ri-gift-line"></i> Gift: {tx.gift}</span>}
                                 {tx.remark && <span className="text-[11px] italic text-slate-400 dark:text-slate-500 whitespace-normal break-words pl-1 opacity-80">"{tx.remark}"</span>}
                               </div>
                             )}
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top pt-5">
                          <div className="flex flex-col gap-1.5 text-xs">
                             <div className="flex justify-between w-32 border-b border-slate-50 dark:border-slate-800 pb-1">
                               <span className="text-slate-500 font-medium">Pur. Price:</span>
                               <span className="font-mono font-bold text-slate-700 dark:text-slate-300">₹{getTxTotalPurchase(tx)}</span>
                             </div>
                             {tx.type === 'Sale' && (
                               <div className="flex justify-between w-32 pt-0.5">
                                 <span className="text-slate-500 font-medium">Sell Price:</span>
                                 <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">₹{getTxTotalSelling(tx)}</span>
                               </div>
                             )}
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top pt-5">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {tx.paymentRecords.length > 0 ? (
                              tx.paymentRecords.map((p, i) => (
                                <span key={i} className="text-[10px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded flex items-center gap-1 shadow-sm font-bold">
                                  <span className="text-slate-500">{p.mode}:</span> 
                                  <span className="font-mono text-slate-700 dark:text-slate-200">₹{p.amount}</span>
                                </span>
                              ))
                            ) : (
                              <span className="text-xs italic text-slate-400">No payment records</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right align-top pt-5">
                          <div className="flex flex-col items-end gap-3">
                            <span className={`px-2 py-0.5 rounded flex items-center gap-1 text-[10px] font-bold uppercase tracking-tight shadow-sm border ${
                              tx.paymentStatus === 'Paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800' : 
                              tx.paymentStatus === 'Partial' ? 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:border-amber-800' : 
                              'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-900/20 dark:border-rose-800'
                            }`}>
                              <i className={tx.paymentStatus === 'Paid' ? 'ri-checkbox-circle-fill' : tx.paymentStatus === 'Partial' ? 'ri-time-fill' : 'ri-close-circle-fill'}></i> {tx.paymentStatus}
                            </span>
                            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                               <button onClick={() => handleView(tx)} className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer font-bold bg-white dark:bg-slate-800 px-2 py-1 rounded-lg transition-all border border-slate-200 dark:border-slate-700 hover:border-indigo-200 shadow-sm active:scale-95">
                                 <i className="ri-eye-line text-sm"></i> VIEW
                               </button>
                               {(activeTab === 'Billing & Invoices' || activeTab === 'Bills' || activeTab === 'Tax Invoices') && (
                                 <>
                                   <button onClick={() => exportInvoice(tx, 'Invoice')} className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-white hover:bg-indigo-600 cursor-pointer font-bold border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded-lg transition-all shadow-sm active:scale-95">
                                     <i className="ri-file-paper-line text-sm"></i> INVOICE
                                   </button>
                                   <button onClick={() => exportInvoice(tx, 'Bill')} className="flex items-center gap-1 text-[11px] text-emerald-600 hover:text-white hover:bg-emerald-600 cursor-pointer font-bold border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-lg transition-all shadow-sm active:scale-95">
                                     <i className="ri-receipt-line text-sm"></i> BILL
                                   </button>
                                 </>
                               )}
                               <button onClick={() => openEditModal(tx)} className="flex items-center gap-1 text-[11px] text-amber-600 hover:text-white hover:bg-amber-600 cursor-pointer font-bold border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-lg transition-all shadow-sm active:scale-95">
                                 <i className="ri-edit-line text-sm"></i> EDIT
                               </button>
                               <button onClick={() => deleteTx(tx.id)} className="flex items-center gap-1 text-[11px] text-rose-600 hover:text-white hover:bg-rose-600 cursor-pointer font-bold border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded-lg transition-all shadow-sm active:scale-95">
                                 <i className="ri-delete-bin-line text-sm"></i> DELETE
                               </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))
                  }</tbody>"""
        content = content[:main_body_start] + new_main_body + content[main_body_end+len('</tbody>'):]

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
