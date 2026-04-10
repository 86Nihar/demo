'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

interface PaymentRecord {
  mode: 'Cash' | 'UPI' | 'Credit Card' | 'Debit Card' | 'Netbanking' | 'Exchange';
  amount: number;
}

interface TransactionItem {
  productName: string;
  imeiNo: string;
  purchasePrice: number;
  sellingPrice: number; // 0 for purchases
}

interface TransactionRecord {
  id: string;
  type: 'Sale' | 'Purchase';
  partyName: string;
  date: string;
  
  // Legacy fields
  productName?: string;
  imeiNo?: string;
  purchasePrice?: number;
  sellingPrice?: number;

  // New multi-item 
  items?: TransactionItem[];

  paymentRecords: PaymentRecord[];
  paymentStatus: 'Paid' | 'Partial' | 'Pending';
  remark?: string;
  gift?: string;
}

const getTxItems = (tx: TransactionRecord): TransactionItem[] => {
  if (tx.items && tx.items.length > 0) return tx.items;
  return [{
    productName: tx.productName || '',
    imeiNo: tx.imeiNo || '',
    purchasePrice: tx.purchasePrice || 0,
    sellingPrice: tx.sellingPrice || 0
  }];
};

const getTxTotalPurchase = (tx: TransactionRecord) => getTxItems(tx).reduce((sum, item) => sum + item.purchasePrice, 0);
const getTxTotalSelling = (tx: TransactionRecord) => getTxItems(tx).reduce((sum, item) => sum + item.sellingPrice, 0);

const AccountantDashboard = () => {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Auth check on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        window.location.href = '/auth';
      } else {
        setUser(session.user);
        setAuthLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        window.location.href = '/auth';
      } else {
        setUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load transactions from Supabase
  const loadTransactions = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (!error && data) {
      const mapped: TransactionRecord[] = data.map((row: any) => ({
        id: row.id,
        type: row.type,
        partyName: row.party_name,
        date: row.date,
        items: row.items,
        paymentRecords: row.payment_records,
        paymentStatus: row.payment_status,
        remark: row.remark,
        gift: row.gift,
      }));
      setTransactions(mapped);
    }
    setIsLoaded(true);
  }, [user]);

  useEffect(() => {
    if (user) loadTransactions();
  }, [user, loadTransactions]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/auth';
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'Sale' | 'Purchase'>('Sale');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formPartyName, setFormPartyName] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formGift, setFormGift] = useState('');
  
  const [formItems, setFormItems] = useState([{
    productName: '',
    imeiNo: '',
    purchasePrice: '' as number | '',
    sellingPrice: '' as number | ''
  }]);

  const [formPayments, setFormPayments] = useState<PaymentRecord[]>([]);
  const [payAmount, setPayAmount] = useState<number | ''>('');
  const [payMode, setPayMode] = useState<PaymentRecord['mode']>('Cash');

  // Report Modal State
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportFilter, setReportFilter] = useState<'All'|'Today'|'SpecificDate'|'Month'>('All');
  const [reportSpecificDate, setReportSpecificDate] = useState(new Date().toISOString().split('T')[0]);
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7));

  const totalCost = formItems.reduce((sum, item) => {
     return sum + (modalType === 'Sale' ? Number(item.sellingPrice || 0) : Number(item.purchasePrice || 0));
  }, 0);
  const totalPaid = formPayments.reduce((sum, p) => sum + p.amount, 0);
  const remainingAmount = Math.max(0, totalCost - totalPaid);

  useEffect(() => {
    if (remainingAmount > 0) {
      setPayAmount(remainingAmount);
    } else {
      setPayAmount('');
    }
  }, [remainingAmount, totalCost]);

  const updateFormItem = (index: number, field: string, value: string | number) => {
    const newItems = [...formItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormItems(newItems);
  };

  const addFormItem = () => {
    setFormItems([...formItems, { productName: '', imeiNo: '', purchasePrice: '', sellingPrice: '' }]);
  };
  
  const removeFormItem = (index: number) => {
    if (formItems.length > 1) {
      setFormItems(formItems.filter((_, i) => i !== index));
    }
  };

  const addPayment = () => {
    if (payAmount && Number(payAmount) > 0) {
      setFormPayments([...formPayments, { mode: payMode, amount: Number(payAmount) }]);
    }
  };

  const removePayment = (index: number) => {
    setFormPayments(formPayments.filter((_, i) => i !== index));
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    let status: 'Paid' | 'Partial' | 'Pending' = 'Pending';
    if (totalPaid >= totalCost && totalCost > 0) status = 'Paid';
    else if (totalPaid > 0) status = 'Partial';

    const mappedItems: TransactionItem[] = formItems.map(it => ({
      productName: it.productName,
      imeiNo: it.imeiNo,
      purchasePrice: Number(it.purchasePrice) || 0,
      sellingPrice: modalType === 'Sale' ? (Number(it.sellingPrice) || 0) : 0
    }));

    const txData: any = {
      user_id: user.id,
      type: modalType,
      party_name: formPartyName,
      date: formDate,
      items: mappedItems,
      payment_records: formPayments,
      payment_status: status,
      remark: formRemark,
      gift: formGift
    };

    if (editingId) {
      txData.id = editingId;
    }

    const { error } = await supabase
      .from('transactions')
      .upsert(txData);

    if (error) {
       alert("Error saving transaction: " + error.message);
    } else {
       loadTransactions();
       setIsModalOpen(false);
       resetForm();
    }
  };

  const resetForm = () => {
    setFormPartyName('');
    setFormRemark('');
    setFormGift('');
    setFormItems([{ productName: '', imeiNo: '', purchasePrice: '', sellingPrice: '' }]);
    setFormPayments([]);
    setPayAmount('');
    setEditingId(null);
  };

  const openModal = (type: 'Sale' | 'Purchase') => {
    resetForm();
    setModalType(type);
    setIsModalOpen(true);
  };

  const openEditModal = (tx: TransactionRecord) => {
    setEditingId(tx.id);
    setModalType(tx.type);
    setFormDate(tx.date);
    setFormPartyName(tx.partyName || '');
    setFormRemark(tx.remark || '');
    setFormGift(tx.gift || '');
    
    const itemsToEdit = getTxItems(tx).map(it => ({
       productName: it.productName,
       imeiNo: it.imeiNo,
       purchasePrice: it.purchasePrice,
       sellingPrice: it.sellingPrice
    }));
    setFormItems(itemsToEdit.length > 0 ? itemsToEdit : [{ productName: '', imeiNo: '', purchasePrice: '', sellingPrice: '' }]);
    
    setFormPayments([...tx.paymentRecords]);
    setIsModalOpen(true);
  };

  const exportPDF = async () => {
    const doc = new jsPDF();
    
    let filteredTx = [...transactions];
    let reportTitleStr = "Full Financial Report";

    if (reportFilter === 'Today') {
      const today = new Date().toISOString().split('T')[0];
      filteredTx = transactions.filter(t => t.date === today);
      reportTitleStr = `Report: ${today}`;
    } else if (reportFilter === 'SpecificDate') {
      filteredTx = transactions.filter(t => t.date === reportSpecificDate);
      reportTitleStr = `Report: ${reportSpecificDate}`;
    } else if (reportFilter === 'Month') {
      filteredTx = transactions.filter(t => t.date.startsWith(reportMonth));
      reportTitleStr = `Monthly Report: ${reportMonth}`;
    }
    
    const salesTx = filteredTx.filter(t => t.type === 'Sale');
    const purchaseTx = filteredTx.filter(t => t.type === 'Purchase');

    let totalSales = 0, totalPurchases = 0, totalProfit = 0, totalLoss = 0;
    let reportSalesItemCount = 0, reportPurchasesItemCount = 0;
    
    const salesPaymentTotals: Record<string, number> = { Cash: 0, UPI: 0, 'Credit Card': 0, 'Debit Card': 0, Netbanking: 0, Exchange: 0 };
    const purchasePaymentTotals: Record<string, number> = { Cash: 0, UPI: 0, 'Credit Card': 0, 'Debit Card': 0, Netbanking: 0, Exchange: 0 };
    const pendingSalesDues: {name: string, due: number}[] = [];
    const pendingPurchaseDues: {name: string, due: number}[] = [];

    salesTx.forEach(tx => {
      const txPur = getTxTotalPurchase(tx);
      const txSell = getTxTotalSelling(tx);

      totalSales += txSell;
      const tProfit = txSell - txPur;
      if (tProfit > 0) totalProfit += tProfit;
      else if (tProfit < 0) totalLoss += Math.abs(tProfit);
      reportSalesItemCount += getTxItems(tx).length;
      
      let paid = 0;
      tx.paymentRecords.forEach(pr => {
          salesPaymentTotals[pr.mode] = (salesPaymentTotals[pr.mode] || 0) + pr.amount;
          paid += pr.amount;
      });
      if (paid < txSell) pendingSalesDues.push({ name: tx.partyName, due: txSell - paid });
    });

    purchaseTx.forEach(tx => {
      const txPur = getTxTotalPurchase(tx);

      totalPurchases += txPur;
      reportPurchasesItemCount += getTxItems(tx).length;
      let paid = 0;
      tx.paymentRecords.forEach(pr => {
          purchasePaymentTotals[pr.mode] = (purchasePaymentTotals[pr.mode] || 0) + pr.amount;
          paid += pr.amount;
      });
      if (paid < txPur) pendingPurchaseDues.push({ name: tx.partyName, due: txPur - paid });
    });

    try {
      const img = new window.Image();
      img.src = '/logo.png';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      doc.addImage(img, 'PNG', 14, 10, 20, 20);
      doc.setFontSize(18);
      doc.text("EZY BUY SELL STORE - Financial Report", 38, 22);
    } catch (e) {
      doc.setFontSize(18);
      doc.text("EZY BUY SELL STORE - Financial Report", 14, 20);
    }

    doc.setFontSize(11);
    doc.text(`Report Period: ${reportFilter === 'All' ? 'All Time' : reportTitleStr.replace('Report: ', '')}`, 14, 32);
    doc.text(`Total Sales: Rs. ${totalSales}`, 14, 38);
    doc.text(`Total Purchases: Rs. ${totalPurchases}`, 14, 44);
    doc.text(`Total Generated Profit: Rs. ${totalProfit}`, 14, 50);
    doc.text(`Total Loss: Rs. ${totalLoss}`, 14, 56);
    doc.text(`Listed Sale Items: ${reportSalesItemCount}`, 14, 62);
    doc.text(`Listed Purchase Items: ${reportPurchasesItemCount}`, 14, 68);

    const rightX = 105;
    const rightX2 = 160;
    doc.setFont('helvetica', 'bold');
    doc.text("Sales Pyts:", rightX, 32);
    doc.text("Purchases Pyts:", rightX2, 32);
    doc.setFont('helvetica', 'normal');
    
    let pyS = 38;
    let pyP = 38;
    Object.entries(salesPaymentTotals).forEach(([mode, amount]) => {
      if (amount > 0) { doc.text(`${mode}: Rs. ${amount}`, rightX, pyS); pyS += 6; }
    });
    Object.entries(purchasePaymentTotals).forEach(([mode, amount]) => {
      if (amount > 0) { doc.text(`${mode}: Rs. ${amount}`, rightX2, pyP); pyP += 6; }
    });

    let currentY = Math.max(pyS, pyP, 80) + 10;

    const formatPayments = (records: PaymentRecord[]) => records.map(p => `${p.mode}:\nRs. ${p.amount}`).join('\n\n');

    if (salesTx.length > 0) {
      doc.setFontSize(14);
      doc.text("Sales Ledger", 14, currentY);
      
      const salesColumn = ["No.", "Date", "Customer & Items", "Pur. Price", "Sell Price", "Payments", "Status"];
      const salesRows = salesTx.map((tx, idx) => {
         const itemsStr = getTxItems(tx).map(it => `• ${it.productName} (${it.imeiNo})`).join('\n');
         const partyStr = (tx.partyName && tx.partyName.toLowerCase() !== 'general' && tx.partyName !== '-') ? `[${tx.partyName}]\n` : '';
         const giftStr = tx.gift ? `\n[Gift: ${tx.gift}]` : '';
         const remarkStr = tx.remark ? `\n(Note: ${tx.remark})` : '';
         return [
           idx + 1,
           tx.date,
           `${partyStr}${itemsStr}${giftStr}${remarkStr}`,
           `Rs. ${getTxTotalPurchase(tx)}`,
           `Rs. ${getTxTotalSelling(tx)}`,
           formatPayments(tx.paymentRecords),
           tx.paymentStatus
         ];
      });

      autoTable(doc, { head: [salesColumn], body: salesRows, startY: currentY + 4, styles: { cellWidth: 'wrap', fontSize: 9 }, headStyles: { fillColor: [79, 70, 229] } });
      currentY = (doc as any).lastAutoTable.finalY + 15;
    }

    if (purchaseTx.length > 0) {
      doc.setFontSize(14);
      doc.text("Purchases Ledger", 14, currentY);

      const purColumn = ["No.", "Date", "Vendor & Items", "Pur. Price", "Payments", "Status"];
      const purRows = purchaseTx.map((tx, idx) => {
         const itemsStr = getTxItems(tx).map(it => `• ${it.productName} (${it.imeiNo})`).join('\n');
         const partyStr = (tx.partyName && tx.partyName.toLowerCase() !== 'general' && tx.partyName !== '-') ? `[${tx.partyName}]\n` : '';
         const remarkStr = tx.remark ? `\n(Note: ${tx.remark})` : '';
         return [
           idx + 1,
           tx.date,
           `${partyStr}${itemsStr}${remarkStr}`,
           `Rs. ${getTxTotalPurchase(tx)}`,
           formatPayments(tx.paymentRecords),
           tx.paymentStatus
         ];
      });

      autoTable(doc, { head: [purColumn], body: purRows, startY: currentY + 4, styles: { cellWidth: 'wrap', fontSize: 9 }, headStyles: { fillColor: [16, 185, 129] } });
      currentY = (doc as any).lastAutoTable.finalY + 15;
    }

    if (pendingSalesDues.length > 0 || pendingPurchaseDues.length > 0) {
       doc.setFontSize(14);
       doc.text("Pending Dues Ledger", 14, currentY);
       
       const duesCol = ["Role", "Customer / Vendor Name", "Due Amount"];
       const duesRows: any[] = [];
       pendingSalesDues.forEach(d => duesRows.push(["Sale (You will receive)", d.name, `Rs. ${d.due}`]));
       pendingPurchaseDues.forEach(d => duesRows.push(["Purchase (You owe)", d.name, `Rs. ${d.due}`]));

       autoTable(doc, { head: [duesCol], body: duesRows, startY: currentY + 4, styles: { cellWidth: 'wrap', fontSize: 9 }, headStyles: { fillColor: [239, 68, 68] } });
       currentY = (doc as any).lastAutoTable.finalY + 15;
    }

    if (salesTx.length === 0 && purchaseTx.length === 0) {
      doc.setFontSize(12);
      doc.text("No transactions found for this period.", 14, currentY + 10);
    }
    
    setReportModalOpen(false);
    doc.save(`Store_Report_${reportFilter === 'All' ? 'All_Time' : reportTitleStr.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`);
  };

  const deleteTx = async (id: string) => {
    if (!confirm("Are you sure you want to delete this record?")) return;
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id);
    
    if (error) {
      alert("Error deleting transaction: " + error.message);
    } else {
      loadTransactions();
    }
  };

  const stats = useMemo(() => {
    let totalsales = 0, totalPurchases = 0, totalProfit = 0, totalLoss = 0, todaySalesCount = 0, todayPurchasesCount = 0;
    let totalDebit = 0, totalCredit = 0, openingCredit = 0, openingDebit = 0;
    const todayStr = new Date().toISOString().split('T')[0];

    transactions.forEach(tx => {
      const txPur = getTxTotalPurchase(tx);
      const txSell = getTxTotalSelling(tx);
      const isToday = tx.date === todayStr;
      
      let txPaid = tx.paymentRecords.reduce((sum, p) => sum + p.amount, 0);

      if (tx.type === 'Sale') {
        totalsales += txSell;
        totalCredit += txPaid;
        if (!isToday && tx.date < todayStr) openingCredit += txPaid;

        const diff = txSell - txPur;
        if (diff > 0) totalProfit += diff;
        else if (diff < 0) totalLoss += Math.abs(diff);
        if (isToday) todaySalesCount += getTxItems(tx).length;
      } else {
        totalPurchases += txPur;
        totalDebit += txPaid;
        if (!isToday && tx.date < todayStr) openingDebit += txPaid;

        if (isToday) todayPurchasesCount += getTxItems(tx).length;
      }
    });

    const openingBalance = openingCredit - openingDebit;
    const closingBalance = totalCredit - totalDebit;

    return {
      cards: [
        { label: 'Total Sales Revenue', value: `₹${totalsales.toLocaleString()}`, icon: '💰', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
        { label: 'Total Purchases Expense', value: `₹${totalPurchases.toLocaleString()}`, icon: '📦', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
        { label: 'Total Profit', value: `₹${totalProfit.toLocaleString()}`, icon: '🚀', color: 'text-indigo-500', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
        { label: 'Total Loss', value: `₹${totalLoss.toLocaleString()}`, icon: '📉', color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-900/20' },
        { label: 'Items Sold Today', value: todaySalesCount.toString(), icon: '🏷️', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
        { label: 'Purchased Today', value: todayPurchasesCount.toString(), icon: '🛒', color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20' },
      ],
      details: { totalDebit, totalCredit, openingBalance, closingBalance, totalProfit, totalLoss }
    };
  }, [transactions]);

  const displayList = activeTab === 'Sales' ? transactions.filter(t => t.type === 'Sale') : 
                      activeTab === 'Purchases' ? transactions.filter(t => t.type === 'Purchase') : transactions;


  return (
    <div className="flex min-h-screen bg-[#f8fafc] dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 font-sans">
      
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-[#1e293b] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 my-8 max-h-[90vh] flex flex-col">
            <div className={`p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center shrink-0 ${modalType === 'Sale' ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
              <h3 className="font-bold text-lg flex items-center gap-2">
                {modalType === 'Sale' ? '🏷️' : '📦'} {editingId ? 'Edit' : 'New'} {modalType} Record
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer text-xl">✕</button>
            </div>
            
            <form onSubmit={handleAddTransaction} className="p-6 overflow-y-auto flex-1 space-y-6">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-500">Date</label>
                  <input required type="date" value={formDate} onChange={e => setFormDate(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                </div>
                {remainingAmount > 0 && (
                  <div className="animate-in fade-in zoom-in duration-300">
                    <label className="block text-xs font-bold mb-1 text-rose-500">{modalType === 'Sale' ? 'Customer Name (Due)' : 'Vendor Name (Due)'}</label>
                    <input type="text" value={formPartyName} onChange={e => setFormPartyName(e.target.value)} placeholder={`e.g. ${modalType === 'Sale' ? 'John Doe' : 'Samsung Dist.'}`} className="w-full bg-rose-50 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-700 rounded-lg px-4 py-2 outline-none focus:border-rose-500" />
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider flex justify-between items-center">
                  Product Details
                  <button type="button" onClick={addFormItem} className="text-xs bg-slate-100 dark:bg-slate-800 px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1 rounded hover:opacity-80 transition cursor-pointer">
                    <span>+</span> Add Another Item
                  </button>
                </h4>

                <div className="space-y-4">
                  {formItems.map((item, idx) => (
                    <div key={idx} className="bg-slate-50/50 dark:bg-slate-800/20 border border-slate-200 dark:border-slate-700 p-4 rounded-xl relative group">
                      {formItems.length > 1 && (
                         <button type="button" onClick={() => removeFormItem(idx)} className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center bg-rose-100 text-rose-600 rounded-full text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow">✕</button>
                      )}
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-slate-500">Product Name</label>
                          <input required type="text" value={item.productName} onChange={e => updateFormItem(idx, 'productName', e.target.value)} placeholder="e.g. iPhone 15 Pro" className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-slate-500">IMEI Number</label>
                          <input required type="text" value={item.imeiNo} onChange={e => updateFormItem(idx, 'imeiNo', e.target.value)} placeholder="15-digit IMEI" className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 tracking-widest font-mono" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-slate-500">Purchase Price (₹)</label>
                          <input required type="number" value={item.purchasePrice} onChange={e => updateFormItem(idx, 'purchasePrice', Number(e.target.value))} placeholder="0.00" className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 font-mono" />
                        </div>
                        {modalType === 'Sale' && (
                          <div>
                            <label className="block text-xs font-semibold mb-1 text-slate-500">Selling Price (₹)</label>
                            <input required type="number" value={item.sellingPrice} onChange={e => updateFormItem(idx, 'sellingPrice', Number(e.target.value))} placeholder="0.00" className="w-full bg-indigo-50/30 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 font-mono" />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                 <h4 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider flex justify-between items-center">
                    Payment Records
                    <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded normal-case font-medium">
                      Total Added: ₹{totalPaid} / ₹{totalCost}
                    </span>
                 </h4>
                 
                 {(remainingAmount > 0 || totalCost === 0) ? (
                    <div className="flex gap-2 mb-4">
                        <input 
                          type="number" 
                          value={payAmount} 
                          onChange={e => setPayAmount(Number(e.target.value))} 
                          placeholder="Amount (₹)" 
                          className="flex-1 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 font-mono" 
                        />
                        <select value={payMode} onChange={e => setPayMode(e.target.value as any)} className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-indigo-500 cursor-pointer">
                          <option value="Cash">Cash</option>
                          <option value="UPI">UPI</option>
                          <option value="Credit Card">Credit Card</option>
                          <option value="Debit Card">Debit Card</option>
                          <option value="Netbanking">Netbanking</option>
                          <option value="Exchange">Exchange</option>
                        </select>
                        <button type="button" onClick={addPayment} className="bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 font-bold px-4 rounded-lg hover:opacity-90 cursor-pointer">Add</button>
                    </div>
                 ) : (
                    <div className="mb-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 p-3 rounded-lg text-sm font-semibold flex items-center justify-between">
                       <span>✅ Complete Amount Added</span>
                       <span>Remaining: ₹{remainingAmount}</span>
                    </div>
                 )}

                 {formPayments.length > 0 && (
                   <ul className="space-y-2 mb-4 max-h-32 overflow-y-auto">
                     {formPayments.map((p, idx) => (
                       <li key={idx} className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 px-3 py-2 rounded-lg border border-slate-100 dark:border-slate-700">
                         <div>
                            <span className="text-xs font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 px-2 py-0.5 rounded mr-2">{p.mode}</span>
                            <span className="font-mono font-medium">₹{p.amount}</span>
                         </div>
                         <button type="button" onClick={() => removePayment(idx)} className="text-rose-400 hover:text-rose-600 font-bold px-2 cursor-pointer">✕</button>
                       </li>
                     ))}
                   </ul>
                 )}
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
                 <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Remarks / Notes</label>
                    <textarea value={formRemark} onChange={e => setFormRemark(e.target.value)} placeholder="Add any extra details, comments..." className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" rows={2}></textarea>
                 </div>
                 {modalType === 'Sale' && (
                   <div>
                      <label className="block text-xs font-semibold mb-1 text-pink-500">🎁 Gift Included (Optional)</label>
                      <input type="text" value={formGift} onChange={e => setFormGift(e.target.value)} placeholder="E.g. Earphones, Back Case..." className="w-full bg-pink-50 dark:bg-pink-900/10 border border-pink-200 dark:border-pink-800 rounded-lg px-4 py-2 outline-none focus:border-pink-500" />
                   </div>
                 )}
               </div>

               <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex gap-3 sticky bottom-0 bg-white dark:bg-[#1e293b] pb-2 mt-4 z-10">
                 <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-medium transition-colors cursor-pointer">Cancel</button>
                 <button type="submit" className={`flex-1 px-4 py-3 text-white rounded-xl font-bold transition-all shadow-lg cursor-pointer ${modalType === 'Sale' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20'}`}>
                   {editingId ? 'Update' : 'Save'} {modalType} Record
                 </button>
               </div>
             </form>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-[#1e293b] border-r border-slate-200 dark:border-slate-800 flex flex-col hidden lg:flex">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="EZY Logo" className="w-12 h-12 object-contain rounded-full shadow-sm bg-white" onError={(e) => {
               (e.target as HTMLImageElement).style.display = 'none';
               (e.target as HTMLImageElement).nextElementSibling!.classList.remove('hidden');
            }} />
            <div className="hidden w-12 h-10 bg-gradient-to-tr from-indigo-600 to-violet-500 rounded-xl flex flex-shrink-0 items-center justify-center text-white font-bold text-sm shadow-lg">
              EZY
            </div>
            <span className="font-bold text-lg tracking-tight leading-tight">BUY SELL STORE</span>
          </div>
        </div>
        
        <div className="p-4 flex gap-2">
           <button onClick={() => openModal('Sale')} className="flex-1 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg transition-colors cursor-pointer text-center">
             + SALE
           </button>
           <button onClick={() => openModal('Purchase')} className="flex-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg transition-colors cursor-pointer text-center">
             + PURCHASE
           </button>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-2">
          {['Dashboard', 'Sales', 'Purchases', 'All Details'].map((item) => (
            <button
              key={item}
              onClick={() => setActiveTab(item)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer ${
                activeTab === item 
                  ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-medium' 
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              <span>{item}</span>
            </button>
          ))}
          <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-900/10 text-rose-600 dark:text-rose-400 transition-all cursor-pointer font-medium"
            >
              <span>🚪 Sign Out</span>
            </button>
          </div>
        </nav>
      </aside>

      {/* Report Modal */}
      {reportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#1e293b] rounded-2xl w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-700">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <h3 className="font-bold text-lg">Generate Report</h3>
              <button onClick={() => setReportModalOpen(false)} className="text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer">✕</button>
            </div>
            <div className="p-6 space-y-4">
               <div>
                  <label className="block text-xs font-semibold mb-2 text-slate-500">Report Period</label>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                     {['All', 'Today', 'Month', 'SpecificDate'].map(mode => (
                       <button 
                         key={mode} 
                         onClick={() => setReportFilter(mode as any)}
                         className={`py-2 px-3 rounded-lg text-xs font-bold border transition ${reportFilter === mode ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'}`}
                       >
                         {mode === 'SpecificDate' ? 'Date' : mode}
                       </button>
                     ))}
                  </div>
               </div>

               {reportFilter === 'SpecificDate' && (
                 <div className="animate-in fade-in">
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Select Date</label>
                    <input type="date" value={reportSpecificDate} onChange={e => setReportSpecificDate(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                 </div>
               )}

               {reportFilter === 'Month' && (
                 <div className="animate-in fade-in">
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Select Month</label>
                    <input type="month" value={reportMonth} onChange={e => setReportMonth(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                 </div>
               )}

               <button onClick={exportPDF} className="w-full py-3 bg-slate-900 dark:bg-indigo-600 hover:opacity-90 text-white rounded-xl font-bold transition shadow-lg mt-4 cursor-pointer">
                 Download PDF Report
               </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-4 lg:p-8 max-w-[1400px] mx-auto w-full">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold">{activeTab} Overview</h1>
            <p className="text-slate-500 dark:text-slate-400">Inventory & Sales financial reports.</p>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setReportModalOpen(true)} className="px-4 py-2 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 font-medium text-sm flex items-center gap-2 cursor-pointer transition-colors">
              <span>📄</span> Generate Report
            </button>
          </div>
        </header>

        {activeTab === 'Dashboard' ? (
          <>
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8 cursor-default">
              {stats.cards.map((stat) => (
                <div key={stat.label} className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <span className={`text-2xl w-12 h-12 flex items-center justify-center rounded-xl ${stat.bg}`}>
                      {stat.icon}
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">{stat.label}</p>
                  <p className={`text-3xl font-bold tracking-tight ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </section>
          </>
        ) : null}

        {activeTab === 'All Details' ? (
          <div className="bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col flex-1 p-6 lg:p-10 animate-in fade-in duration-300">
             <h2 className="text-2xl font-bold mb-6 border-b border-slate-100 dark:border-slate-800 pb-4 flex items-center gap-2">📊 Comprehensive Financial Summary</h2>
             
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                   <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Cash Flow (All Time)</h3>
                   <div className="space-y-4">
                      <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700">
                         <span className="text-slate-600 dark:text-slate-300 font-medium text-sm">Total Credit (Cash In)</span>
                         <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xl font-mono">₹{stats.details.totalCredit.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700">
                         <span className="text-slate-600 dark:text-slate-300 font-medium text-sm">Total Debit (Cash Out)</span>
                         <span className="text-rose-600 dark:text-rose-400 font-bold text-xl font-mono">₹{stats.details.totalDebit.toLocaleString()}</span>
                      </div>
                   </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                   <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Account Balances</h3>
                   <div className="space-y-4">
                      <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700">
                         <span className="text-slate-600 dark:text-slate-300 font-medium text-sm">Opening Balance<br/><span className="text-[10px] uppercase text-slate-400">(Till Yesterday)</span></span>
                         <span className="text-indigo-600 dark:text-indigo-400 font-bold text-xl font-mono">₹{stats.details.openingBalance.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-lg shadow-sm border border-indigo-200 dark:border-indigo-800">
                         <span className="text-indigo-800 dark:text-indigo-300 font-bold text-sm">Closing Balance<br/><span className="text-[10px] uppercase.opacity-70">(Net Available)</span></span>
                         <span className="text-indigo-700 dark:text-indigo-400 font-bold text-2xl font-mono tracking-tight">₹{stats.details.closingBalance.toLocaleString()}</span>
                      </div>
                   </div>
                </div>
             </div>

             <div className="bg-indigo-50 dark:bg-indigo-900/20 p-6 rounded-xl border border-indigo-100 dark:border-indigo-800">
                <h3 className="text-sm font-bold text-indigo-800 dark:text-indigo-400 uppercase tracking-wider mb-4">Profit & Loss Summary (All Time)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm">
                      <span className="font-medium text-sm text-slate-600 dark:text-slate-300">Net Profit</span>
                      <span className="text-emerald-500 font-bold text-xl font-mono">₹{stats.details.totalProfit.toLocaleString()}</span>
                   </div>
                   <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm">
                      <span className="font-medium text-sm text-slate-600 dark:text-slate-300">Net Loss</span>
                      <span className="text-rose-500 font-bold text-xl font-mono">₹{stats.details.totalLoss.toLocaleString()}</span>
                   </div>
                </div>
             </div>
          </div>
        ) : null}

        {(activeTab === 'Dashboard' || activeTab === 'Sales' || activeTab === 'Purchases') && (
          <div className="bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col flex-1">
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
               <h2 className="font-bold text-lg">
                 {activeTab === 'Dashboard' ? 'Recent Activity Ledger' : `${activeTab} Records`}
               </h2>
            </div>
            
            <div className="overflow-x-auto min-h-[300px]">
              <table className="w-full text-left whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-100/50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">
                    <th className="px-6 py-4">No./Date</th>
                    <th className="px-6 py-4">Products & IMEI</th>
                    <th className="px-6 py-4">Financials</th>
                    <th className="px-6 py-4">Payments Breakdown</th>
                    <th className="px-6 py-4 text-right">Status/Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {displayList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-500">
                        No records found. Click &quot;+ SALE&quot; or &quot;+ PURCHASE&quot; to add one.
                      </td>
                    </tr>
                  ) : (
                    displayList.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors group">
                        <td className="px-6 py-4 align-top">
                          <div className="flex flex-col pt-1">
                            <span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{tx.id.substring(0,8)}</span>
                            <span className="text-xs text-slate-500">{tx.date}</span>
                            <span className={`mt-2 text-[10px] w-max px-2 py-0.5 rounded font-bold uppercase tracking-tight ${tx.type === 'Sale' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'}`}>
                              {tx.type}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top">
                          <div className="flex flex-col gap-2">
                             <div className="flex items-center gap-2">
                               {tx.partyName && tx.partyName.toLowerCase() !== 'general' && tx.partyName !== '-' && (
                                 <span className="font-bold text-xs text-slate-500 uppercase">{tx.partyName}</span>
                               )}
                               <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[10px] text-slate-500 lowercase font-medium border border-slate-200 dark:border-slate-700">{getTxItems(tx).length} item(s)</span>
                             </div>
                             <div className="flex flex-col gap-2 border-l-2 border-slate-200 dark:border-slate-700 pl-3 py-1">
                               {getTxItems(tx).map((it, idx) => (
                                 <div key={idx} className="flex flex-col whitespace-normal min-w-[200px]">
                                   <span className="font-semibold text-sm leading-tight text-slate-800 dark:text-slate-200">{it.productName}</span>
                                   <span className="text-[11px] font-mono text-slate-500 mt-0.5">IMEI: {it.imeiNo}</span>
                                 </div>
                               ))}
                             </div>
                             {(tx.remark || tx.gift) && (
                               <div className="mt-1 flex flex-col gap-1">
                                 {tx.gift && <span className="text-xs text-pink-600 bg-pink-100 dark:bg-pink-900/30 px-2 py-1 rounded-md max-w-max">🎁 Gift: {tx.gift}</span>}
                                 {tx.remark && <span className="text-xs italic text-slate-500 dark:text-slate-400">"{tx.remark}"</span>}
                               </div>
                             )}
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top pt-5">
                          <div className="flex flex-col gap-1.5 text-xs">
                             <div className="flex justify-between w-32 border-b border-slate-100 dark:border-slate-800 pb-1">
                               <span className="text-slate-500">Pur. Price:</span>
                               <span className="font-mono font-medium">₹{getTxTotalPurchase(tx)}</span>
                             </div>
                             {tx.type === 'Sale' && (
                               <div className="flex justify-between w-32 pt-0.5">
                                 <span className="text-slate-500">Sell Price:</span>
                                 <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">₹{getTxTotalSelling(tx)}</span>
                               </div>
                             )}
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top pt-5">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {tx.paymentRecords.length > 0 ? (
                              tx.paymentRecords.map((p, i) => (
                                <span key={i} className="text-[10px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded flex items-center gap-1 shadow-sm">
                                  <span className="font-bold text-slate-600 dark:text-slate-300">{p.mode}:</span> 
                                  <span className="font-mono">₹{p.amount}</span>
                                </span>
                              ))
                            ) : (
                              <span className="text-xs italic text-slate-400">No payment records</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right align-top pt-5">
                          <div className="flex flex-col items-end gap-2">
                            <span className={`px-3 py-1 rounded flex items-center gap-1 text-[11px] font-bold uppercase tracking-tight shadow-sm ${
                              tx.paymentStatus === 'Paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30' : 
                              tx.paymentStatus === 'Partial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30' : 
                              'bg-rose-100 text-rose-700 dark:bg-rose-900/30'
                            }`}>
                              {tx.paymentStatus === 'Paid' ? '✅' : tx.paymentStatus === 'Partial' ? '⏳' : '❌'} {tx.paymentStatus}
                            </span>
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => openEditModal(tx)} className="text-xs text-indigo-500 hover:text-indigo-700 hover:underline cursor-pointer font-semibold bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded">
                                Edit
                              </button>
                              <button onClick={() => deleteTx(tx.id)} className="text-xs text-rose-500 hover:text-rose-700 hover:underline cursor-pointer font-semibold bg-rose-50 dark:bg-rose-900/30 px-2 py-0.5 rounded">
                                Delete
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AccountantDashboard;
