'use client';

import React, { useState, useMemo, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PaymentRecord {
  mode: 'Cash' | 'UPI' | 'Card' | 'Bank Transfer';
  amount: number;
}

interface TransactionRecord {
  id: string;
  type: 'Sale' | 'Purchase';
  productName: string;
  imeiNo: string;
  date: string;
  purchasePrice: number;
  sellingPrice: number; // 0 for purchases
  paymentRecords: PaymentRecord[];
  paymentStatus: 'Paid' | 'Partial' | 'Pending';
}

const initialTransactions: TransactionRecord[] = [];

const AccountantDashboard = () => {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [transactions, setTransactions] = useState<TransactionRecord[]>(initialTransactions);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'Sale' | 'Purchase'>('Sale');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formProduct, setFormProduct] = useState('');
  const [formImei, setFormImei] = useState('');
  const [formPurchasePrice, setFormPurchasePrice] = useState<number | ''>('');
  const [formSellingPrice, setFormSellingPrice] = useState<number | ''>('');
  const [formPayments, setFormPayments] = useState<PaymentRecord[]>([]);

  // Temp Payment Input
  const [payAmount, setPayAmount] = useState<number | ''>('');
  const [payMode, setPayMode] = useState<PaymentRecord['mode']>('Cash');

  // Dynamic calculations for the Modal
  const totalCost = modalType === 'Sale' ? Number(formSellingPrice || 0) : Number(formPurchasePrice || 0);
  const totalPaid = formPayments.reduce((sum, p) => sum + p.amount, 0);
  const remainingAmount = Math.max(0, totalCost - totalPaid);

  // Auto-update the payment input box with the remaining amount automatically
  useEffect(() => {
    if (remainingAmount > 0) {
      setPayAmount(remainingAmount);
    } else {
      setPayAmount('');
    }
  }, [remainingAmount, totalCost]);

  const addPayment = () => {
    if (payAmount && Number(payAmount) > 0) {
      // Don't allow adding more than remaining if they overpay? Let's just add it.
      setFormPayments([...formPayments, { mode: payMode, amount: Number(payAmount) }]);
      // payAmount will auto-update via useEffect based on new remainingAmount
    }
  };

  const removePayment = (index: number) => {
    setFormPayments(formPayments.filter((_, i) => i !== index));
  };

  const handleAddTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Auto calculate payment status
    const finalTotalPaid = formPayments.reduce((sum, p) => sum + p.amount, 0);
    const finalTotalCost = modalType === 'Sale' ? Number(formSellingPrice) : Number(formPurchasePrice);
    
    let status: 'Paid' | 'Partial' | 'Pending' = 'Pending';
    if (finalTotalPaid >= finalTotalCost && finalTotalCost > 0) status = 'Paid';
    else if (finalTotalPaid > 0) status = 'Partial';

    const txData: TransactionRecord = {
      id: editingId || `TX${String(transactions.length + 1).padStart(3, '0')}`,
      type: modalType,
      productName: formProduct,
      imeiNo: formImei,
      date: formDate,
      purchasePrice: Number(formPurchasePrice) || 0,
      sellingPrice: modalType === 'Sale' ? (Number(formSellingPrice) || 0) : 0,
      paymentRecords: formPayments,
      paymentStatus: status
    };

    if (editingId) {
      setTransactions(transactions.map(t => t.id === editingId ? txData : t));
    } else {
      setTransactions([txData, ...transactions]);
    }
    
    setIsModalOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setFormProduct('');
    setFormImei('');
    setFormPurchasePrice('');
    setFormSellingPrice('');
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
    setFormProduct(tx.productName);
    setFormImei(tx.imeiNo);
    setFormPurchasePrice(tx.purchasePrice);
    setFormSellingPrice(tx.sellingPrice);
    setFormPayments([...tx.paymentRecords]);
    setIsModalOpen(true);
  };

  const exportPDF = async () => {
    const doc = new jsPDF();
    
    // Split data
    const salesTx = transactions.filter(t => t.type === 'Sale');
    const purchaseTx = transactions.filter(t => t.type === 'Purchase');

    // Overview Stats
    let totalSales = 0, totalPurchases = 0, totalProfit = 0, totalLoss = 0;
    let todaySales = 0, todayPurchases = 0;
    const todayDate = new Date().toISOString().split('T')[0];

    salesTx.forEach(tx => {
      totalSales += tx.sellingPrice;
      const tProfit = tx.sellingPrice - tx.purchasePrice;
      if (tProfit > 0) totalProfit += tProfit;
      else if (tProfit < 0) totalLoss += Math.abs(tProfit);
      
      if (tx.date === todayDate) todaySales++;
    });
    purchaseTx.forEach(tx => {
      totalPurchases += tx.purchasePrice;
      if (tx.date === todayDate) todayPurchases++;
    });

    // Document Header & Logo
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
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 36);
    doc.text(`Total Sales: Rs. ${totalSales}`, 14, 42);
    doc.text(`Total Purchases: Rs. ${totalPurchases}`, 14, 48);
    doc.text(`Total Profit: Rs. ${totalProfit}`, 14, 54);
    doc.text(`Total Loss: Rs. ${totalLoss}`, 14, 60);
    doc.text(`Items Sold Today: ${todaySales}`, 14, 66);
    doc.text(`Items Purchased Today: ${todayPurchases}`, 14, 72);

    let currentY = 82;

    // --- SALES SECTION ---
    if (salesTx.length > 0) {
      doc.setFontSize(14);
      doc.text("Sales Ledger", 14, currentY);
      
      const salesColumn = ["ID", "Date", "Product & IMEI", "Pur. Price", "Sell Price", "Status"];
      const salesRows = salesTx.map(tx => [
        tx.id,
        tx.date,
        `${tx.productName}\n(${tx.imeiNo})`,
        `Rs. ${tx.purchasePrice}`,
        `Rs. ${tx.sellingPrice}`,
        tx.paymentStatus
      ]);

      autoTable(doc, {
        head: [salesColumn],
        body: salesRows,
        startY: currentY + 4,
        styles: { cellWidth: 'wrap', fontSize: 9 },
        headStyles: { fillColor: [79, 70, 229] } // Indigo
      });
      
      currentY = (doc as any).lastAutoTable.finalY + 15;
    }

    // --- PURCHASES SECTION ---
    if (purchaseTx.length > 0) {
      doc.setFontSize(14);
      doc.text("Purchases Ledger", 14, currentY);
      
      const purColumn = ["ID", "Date", "Product & IMEI", "Pur. Price", "Status"];
      const purRows = purchaseTx.map(tx => [
        tx.id,
        tx.date,
        `${tx.productName}\n(${tx.imeiNo})`,
        `Rs. ${tx.purchasePrice}`,
        tx.paymentStatus
      ]);

      autoTable(doc, {
        head: [purColumn],
        body: purRows,
        startY: currentY + 4,
        styles: { cellWidth: 'wrap', fontSize: 9 },
        headStyles: { fillColor: [16, 185, 129] } // Emerald
      });
    }

    if (salesTx.length === 0 && purchaseTx.length === 0) {
      doc.setFontSize(12);
      doc.text("No transactions found.", 14, currentY + 10);
    }
    
    doc.save(`Store_Report_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const deleteTx = (id: string) => {
    setTransactions(transactions.filter(t => t.id !== id));
  };

  // Dashboard Stats Calculations
  const stats = useMemo(() => {
    let totalsales = 0;
    let totalPurchases = 0;
    let totalProfit = 0;
    let totalLoss = 0;
    let todaySalesCount = 0;
    let todayPurchasesCount = 0;
    
    const todayStr = new Date().toISOString().split('T')[0];

    transactions.forEach(tx => {
      if (tx.type === 'Sale') {
        totalsales += tx.sellingPrice;
        const diff = tx.sellingPrice - tx.purchasePrice;
        if (diff > 0) totalProfit += diff;
        else if (diff < 0) totalLoss += Math.abs(diff);
        
        if (tx.date === todayStr) todaySalesCount++;
      } else {
        totalPurchases += tx.purchasePrice;
        if (tx.date === todayStr) todayPurchasesCount++;
      }
    });

    return [
      { label: 'Total Sales Revenue', value: `₹${totalsales.toLocaleString()}`, icon: '💰', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
      { label: 'Total Purchases Expense', value: `₹${totalPurchases.toLocaleString()}`, icon: '📦', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
      { label: 'Total Profit', value: `₹${totalProfit.toLocaleString()}`, icon: '🚀', color: 'text-indigo-500', bg: 'bg-indigo-50 dark:bg-indigo-900/20' },
      { label: 'Total Loss', value: `₹${totalLoss.toLocaleString()}`, icon: '📉', color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-900/20' },
      { label: 'Items Sold Today', value: todaySalesCount.toString(), icon: '🏷️', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
      { label: 'Purchased Today', value: todayPurchasesCount.toString(), icon: '🛒', color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-900/20' },
    ];
  }, [transactions]);

  const salesList = transactions.filter(t => t.type === 'Sale');
  const purchasesList = transactions.filter(t => t.type === 'Purchase');

  const displayList = activeTab === 'Sales' ? salesList : 
                      activeTab === 'Purchases' ? purchasesList : 
                      transactions;

  return (
    <div className="flex min-h-screen bg-[#f8fafc] dark:bg-[#0f172a] text-slate-900 dark:text-slate-100 font-sans">
      
      {/* Modal popup */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-[#1e293b] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 my-8">
            <div className={`p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center ${modalType === 'Sale' ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
              <h3 className="font-bold text-lg flex items-center gap-2">
                {modalType === 'Sale' ? '🏷️' : '📦'} {editingId ? 'Edit' : 'New'} {modalType} Record
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer text-xl">✕</button>
            </div>
            
            <form onSubmit={handleAddTransaction} className="p-6 space-y-6">
              {/* Product Info Section */}
              <div>
                <h4 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider">Product Info</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Date</label>
                    <input required type="date" value={formDate} onChange={e => setFormDate(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Product Name</label>
                    <input required type="text" value={formProduct} onChange={e => setFormProduct(e.target.value)} placeholder="e.g. iPhone 15 Pro" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold mb-1 text-slate-500">IMEI Number</label>
                    <input required type="text" value={formImei} onChange={e => setFormImei(e.target.value)} placeholder="15-digit IMEI" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 tracking-widest font-mono" />
                  </div>
                </div>
              </div>

              {/* Pricing Section */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                <h4 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider">Pricing (₹)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Purchase Price</label>
                    <input required type="number" value={formPurchasePrice} onChange={e => setFormPurchasePrice(Number(e.target.value))} placeholder="0.00" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 font-mono" />
                  </div>
                  {modalType === 'Sale' && (
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-slate-500">Selling Price</label>
                      <input required type="number" value={formSellingPrice} onChange={e => setFormSellingPrice(Number(e.target.value))} placeholder="0.00" className="w-full bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 font-mono" />
                    </div>
                  )}
                </div>
                {/* Profit is no longer shown individually individually here as per request */}
              </div>

              {/* Multi-Payment Section */}
              <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                 <h4 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider flex justify-between items-center">
                    Payment Records
                    <span className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded normal-case font-medium">
                      Total Added: ₹{totalPaid} / ₹{totalCost}
                    </span>
                 </h4>
                 
                 {remainingAmount > 0 ? (
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
                          <option value="Card">Card</option>
                          <option value="Bank Transfer">Bank Transfer</option>
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

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex gap-3">
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
          {['Dashboard', 'Sales', 'Purchases', 'Reports'].map((item) => (
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
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-4 lg:p-8 max-w-[1400px] mx-auto w-full">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold">{activeTab} Overview</h1>
            <p className="text-slate-500 dark:text-slate-400">Inventory & Sales financial reports.</p>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={exportPDF} className="px-4 py-2 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 font-medium text-sm flex items-center gap-2 cursor-pointer transition-colors">
              <span>📄</span> Export Full Report
            </button>
          </div>
        </header>

        {activeTab === 'Dashboard' ? (
          <>
            {/* Stats Grid */}
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8 cursor-default">
              {stats.map((stat) => (
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

        {/* Transactions Table for Dashboard, Sales, or Purchases */}
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
                    <th className="px-6 py-4">ID/Date</th>
                    <th className="px-6 py-4">Product & IMEI</th>
                    <th className="px-6 py-4">Financials</th>
                    <th className="px-6 py-4">Payments Breakdown</th>
                    <th className="px-6 py-4 text-right">Status/Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {displayList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-500">
                        No records found. Click "+ SALE" or "+ PURCHASE" to add one.
                      </td>
                    </tr>
                  ) : (
                    displayList.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{tx.id}</span>
                            <span className="text-xs text-slate-500">{tx.date}</span>
                            <span className={`mt-1 text-[10px] w-max px-2 py-0.5 rounded font-bold uppercase tracking-tight ${tx.type === 'Sale' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'}`}>
                              {tx.type}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-semibold text-sm">{tx.productName}</span>
                            <span className="text-xs font-mono text-slate-500 mt-0.5 bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded w-max border border-slate-200 dark:border-slate-700">IMEI: {tx.imeiNo}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1 text-xs">
                             <div className="flex justify-between w-32 border-b border-slate-100 dark:border-slate-800 pb-1">
                               <span className="text-slate-500">Pur. Price:</span>
                               <span className="font-mono font-medium">₹{tx.purchasePrice}</span>
                             </div>
                             {tx.type === 'Sale' && (
                               <div className="flex justify-between w-32 pt-0.5">
                                 <span className="text-slate-500">Sell Price:</span>
                                 <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">₹{tx.sellingPrice}</span>
                               </div>
                             )}
                             {/* Removed individual profit calculation from the table as requested */}
                          </div>
                        </td>
                        <td className="px-6 py-4">
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
                        <td className="px-6 py-4 text-right">
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
