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

interface TransactionRecord {
  id: string;
  type: 'Sale' | 'Purchase' | 'Advance' | 'Cash In' | 'Cash Out' | 'Opening Balance';
  partyName: string;
  date: string;
  isExcluded?: boolean;
  
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

interface TransactionItem {
  productName: string;
  imeiNo: string;
  purchasePrice: number;
  sellingPrice: number; // 0 for purchases
  statusOverride?: 'ACTIVE' | 'INACTIVE';
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
        isExcluded: row.is_excluded,
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
  const [modalType, setModalType] = useState<'Sale' | 'Purchase' | 'Advance' | 'CashEntry'>('Sale');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formPartyName, setFormPartyName] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formGift, setFormGift] = useState('');
  
  const [formCashType, setFormCashType] = useState<'Cash In' | 'Cash Out' | 'Opening Balance'>('Cash In');
  const [formGiverName, setFormGiverName] = useState('');
  const [formReceiverName, setFormReceiverName] = useState('');
  const [itemTab, setItemTab] = useState<'Active' | 'Inactive'>('Active');
  const [searchQuery, setSearchQuery] = useState('');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [selectedInventory, setSelectedInventory] = useState<string[]>([]);
  
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
  const [reportType, setReportType] = useState<'SalesPurchases'|'AllDetails'|'CashReport'|'ItemsReport'>('SalesPurchases');
  const [reportFilter, setReportFilter] = useState<'All'|'Today'|'Yesterday'|'SpecificDate'|'Month'>('All');
  const [reportSpecificDate, setReportSpecificDate] = useState(new Date().toISOString().split('T')[0]);
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7));

  // Dashboard filter state
  const [dashboardFilter, setDashboardFilter] = useState<'All'|'Today'|'Yesterday'|'SpecificDate'|'Month'>('All');
  const [dashSpecificDate, setDashSpecificDate] = useState(new Date().toISOString().split('T')[0]);
  const [dashMonth, setDashMonth] = useState(new Date().toISOString().slice(0, 7));

  const totalCost = formItems.reduce((sum, item) => {
     return sum + ((modalType === 'Sale' || modalType === 'Advance') ? Number(item.sellingPrice || 0) : Number(item.purchasePrice || 0));
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

    // Advance Detection Logic
    if (modalType === 'Sale' && field === 'imeiNo' && value) {
       const matchingAdv = parsedData.activeAdvances.find(adv => 
          getTxItems(adv).some(it => it.imeiNo === value)
       );
       
       if (matchingAdv) {
          const advItems = getTxItems(matchingAdv);
          const advItem = advItems.find(it => it.imeiNo === value);
          const advPaid = matchingAdv.paymentRecords.reduce((sum, p) => sum + p.amount, 0);

          if (confirm(`Found active Advance for this IMEI!\nCustomer: ${matchingAdv.partyName}\nAdvance Amount: ₹${advPaid}\n\nDo you want to add this amount to current Sale payments?`)) {
             // Add payment record
             setFormPayments(prev => [...prev, { mode: 'Cash', amount: advPaid }]);
             // Fill customer name
             setFormPartyName(matchingAdv.partyName);
             // Optionally fill product name
             if (advItem) {
                newItems[index].productName = advItem.productName;
                newItems[index].purchasePrice = advItem.purchasePrice;
                setFormItems([...newItems]);
             }
             // Store the advance ID to delete on save
             (window as any)._pendingAdvanceId = matchingAdv.id;
             alert("Advance added to payments. The old advance record will be removed upon saving this sale.");
          }
       }
    }
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
    
    let txData: any = {
      user_id: user.id,
      date: formDate,
      remark: formRemark,
      gift: formGift
    };

    if (modalType === 'CashEntry') {
       txData.type = formCashType;
       txData.party_name = `${formGiverName}|||${formReceiverName}`;
       txData.items = [];
       txData.payment_records = [{ mode: 'Cash', amount: Number(payAmount) }];
       txData.payment_status = 'Paid';
       txData.is_excluded = transactions.find(t => t.id === editingId)?.isExcluded || false;
    } else {
       let status: 'Paid' | 'Partial' | 'Pending' = 'Pending';
       if (totalPaid >= totalCost && totalCost > 0) status = 'Paid';
       else if (totalPaid > 0) status = 'Partial';

       const mappedItems: TransactionItem[] = formItems.map(it => ({
         productName: it.productName,
         imeiNo: it.imeiNo,
         purchasePrice: Number(it.purchasePrice) || 0,
         sellingPrice: modalType === 'Sale' ? (Number(it.sellingPrice) || 0) : 0
       }));

       txData.type = modalType;
       txData.party_name = formPartyName;
       txData.items = mappedItems;
       txData.payment_records = formPayments;
       txData.payment_status = status;
    }

    if (editingId) {
      txData.id = editingId;
    }

    const { error } = await supabase
      .from('transactions')
      .upsert(txData);

    if (error) {
       alert("Error saving transaction: " + error.message);
    } else {
       // Handle pending advance deletion
       const pendingAdvId = (window as any)._pendingAdvanceId;
       if (pendingAdvId) {
          await supabase.from('transactions').delete().eq('id', pendingAdvId);
          (window as any)._pendingAdvanceId = null;
       }
       
       loadTransactions();
       setIsModalOpen(false);
       resetForm();
    }
  };

  const handleBulkImport = async () => {
      try {
          if (!user) return alert("Must be signed in");
          const btn = document.getElementById('import-btn');
          if (btn) btn.innerText = "Importing...";
          
          const res = await fetch('/api/inventory/import');
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          
          const products = data.products;
          
          let newTxCount = 0;
          let skippedCount = 0;
          
          const existingImeis = new Set<string>();
          const existingUnknowns = new Set<string>();
          
          transactions.forEach(tx => {
             getTxItems(tx).forEach(it => {
                 if (!it.imeiNo.startsWith("UNKNOWN")) existingImeis.add(it.imeiNo);
                 else existingUnknowns.add(`${it.productName}-${it.purchasePrice}`);
             });
          });

          for (const p of products) {
             let exists = false;
             if (!p.imeiNo.startsWith("UNKNOWN")) {
                 exists = existingImeis.has(p.imeiNo);
             } else {
                 exists = existingUnknowns.has(`${p.name}-${p.purchasePrice}`);
             }

             if (exists) {
                 skippedCount++;
                 continue;
             }

             let txData = {
                 user_id: user.id,
                 date: p.isoDate,
                 type: 'Purchase',
                 party_name: 'System Import',
                 remark: 'Imported from prodect.txt',
                 gift: '',
                 payment_status: 'Pending',
                 payment_records: [],
                 items: [{
                     productName: p.name,
                     imeiNo: p.imeiNo,
                     purchasePrice: p.purchasePrice,
                     sellingPrice: 0
                 }]
             };

             const { error } = await supabase.from('transactions').insert([txData]);
             if (error) {
                 console.error("Import error", error);
             } else {
                 newTxCount++;
                 if (!p.imeiNo.startsWith("UNKNOWN")) existingImeis.add(p.imeiNo);
                 else existingUnknowns.add(`${p.name}-${p.purchasePrice}`);
             }
          }

          loadTransactions();
          alert(`Import complete! Added ${newTxCount} products. Skipped ${skippedCount} existing products.`);
          if (btn) btn.innerText = "IMPORT TXT";
      } catch (err: any) {
          alert('Failed to import: ' + err.message);
          const btn = document.getElementById('import-btn');
          if (btn) btn.innerText = "IMPORT TXT";
      }
  };

  const resetForm = () => {
    setFormPartyName('');
    setFormGiverName('');
    setFormReceiverName('');
    setFormRemark('');
    setFormGift('');
    setFormItems([{ productName: '', imeiNo: '', purchasePrice: '', sellingPrice: '' }]);
    setFormPayments([]);
    setPayAmount('');
    setEditingId(null);
    setFormCashType('Cash In');
  };

  const openModal = (type: 'Sale' | 'Purchase' | 'Advance' | 'CashEntry') => {
    resetForm();
    setModalType(type);
    setIsModalOpen(true);
  };

  const openEditModal = (tx: TransactionRecord) => {
    setEditingId(tx.id);
    setFormDate(tx.date);
    setFormRemark(tx.remark || '');
    setFormGift(tx.gift || '');
    
    if (tx.type === 'Cash In' || tx.type === 'Cash Out') {
       setModalType('CashEntry');
       setFormCashType(tx.type);
       const parts = (tx.partyName || '|||').split('|||');
       setFormGiverName(parts[0] || '');
       setFormReceiverName(parts[1] || parts[0] || '');
       setPayAmount(tx.paymentRecords[0]?.amount || '');
       setIsModalOpen(true);
       return;
    }

    setModalType(tx.type as any);
    setFormPartyName(tx.partyName || '');
    
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
    const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
    const margin = { top: 19.1, bottom: 19.1, left: 6.4, right: 6.4 };
    
    let filteredTx = [...transactions];
    let reportTitleStr = reportType === 'AllDetails' ? "All Details Report" : 
                         reportType === 'CashReport' ? "Cash Tracker Report" : 
                         reportType === 'ItemsReport' ? "Inventory Items Report" : "Basic Sale & Purchase Report";

    if (reportFilter === 'Today') {
      const today = new Date().toISOString().split('T')[0];
      filteredTx = transactions.filter(t => t.date === today);
      reportTitleStr += ` - ${today}`;
    } else if (reportFilter === 'Yesterday') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = yesterday.toISOString().split('T')[0];
      filteredTx = transactions.filter(t => t.date === yStr);
      reportTitleStr += ` - ${yStr}`;
    } else if (reportFilter === 'SpecificDate') {
      filteredTx = transactions.filter(t => t.date === reportSpecificDate);
      reportTitleStr += ` - ${reportSpecificDate}`;
    } else if (reportFilter === 'Month') {
      filteredTx = transactions.filter(t => t.date.startsWith(reportMonth));
      reportTitleStr += ` - ${reportMonth}`;
    }

    try {
      const img = new window.Image();
      img.src = '/logo.png';
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
      doc.addImage(img, 'PNG', margin.left, margin.top - 10, 20, 20);
      doc.setFontSize(18);
      doc.text(`EZY BUY SELL STORE - ${reportTitleStr}`, margin.left + 25, margin.top + 2);
    } catch (e) {
      doc.setFontSize(18);
      doc.text(`EZY BUY SELL STORE - ${reportTitleStr}`, margin.left, margin.top);
    }

    let currentY = margin.top + 15;

    if (reportType === 'AllDetails') {
       doc.setFontSize(11);
       doc.text(`Total Active Products: ${parsedData.activeProducts.length}`, margin.left, currentY);
       doc.text(`Total Stock Value: Rs. ${parsedData.totalProductStockPrice}`, margin.left, currentY + 6);
       doc.text(`Opening Balance: Rs. ${parsedData.details.openingBalance}`, margin.left, currentY + 12);
       doc.text(`Closing Balance: Rs. ${parsedData.details.closingBalance}`, margin.left, currentY + 18);
       doc.text(`Total Income (Cash In): Rs. ${parsedData.details.filteredCashIn}`, margin.left, currentY + 24);
       doc.text(`Total Expense (Cash Out): Rs. ${parsedData.details.filteredCashOut}`, margin.left, currentY + 30);
       doc.text(`Total Generated Profit: Rs. ${parsedData.details.totalProfit}`, margin.left, currentY + 36);
       
       let rightX = 140;
       doc.text(`Total Gifts Tracked:`, rightX, currentY);
       let gY = currentY + 6;
       parsedData.gifts.forEach(([name, counts]) => {
           doc.text(`- ${name}: ${counts.out} Given`, rightX, gY);
           gY += 6;
       });
       
       currentY = Math.max(currentY + 42, gY) + 10;
       
       const advTx = filteredTx.filter(t => t.type === 'Advance');
       if (advTx.length > 0) {
          doc.setFontSize(14);
          doc.text("Advances Ledger", margin.left, currentY);
          const advHeaders = ["Date", "Customer Info", "Model & IMEI", "Advance Amount", "Payments"];
          const advRows = advTx.map((tx) => {
             const custInfo = `${tx.partyName || ''}\n${tx.remark || ''}`;
             const itemInfo = getTxItems(tx).map(it => `${it.productName}\nIMEI: ${it.imeiNo}\nPur. Price: Rs. ${it.purchasePrice}`).join('\n\n');
             const advAmt = getTxTotalSelling(tx);
             return [tx.date, custInfo, itemInfo, `Rs. ${advAmt}`, tx.paymentRecords.map(p => `${p.mode}: Rs. ${p.amount}`).join('\n')];
          });
          autoTable(doc, { head: [advHeaders], body: advRows, startY: currentY + 4, margin, styles: { cellWidth: 'auto', fontSize: 9, overflow: 'linebreak' }, headStyles: { fillColor: [245, 158, 11] }, columnStyles: { 1: { cellWidth: 50 }, 2: { cellWidth: 80 } } });
       }

    } else if (reportType === 'SalesPurchases') {
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
         if (tProfit > 0) totalProfit += tProfit; else if (tProfit < 0) totalLoss += Math.abs(tProfit);
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

       doc.setFontSize(11);
       doc.text(`Report Period: ${reportFilter === 'All' ? 'All Time' : reportTitleStr.replace('Basic Sale & Purchase Report - ', '')}`, margin.left, currentY);
       doc.text(`Total Sales: Rs. ${totalSales}`, margin.left, currentY + 6);
       doc.text(`Total Purchases: Rs. ${totalPurchases}`, margin.left, currentY + 12);
       doc.text(`Total Generated Profit: Rs. ${totalProfit}`, margin.left, currentY + 18);
       doc.text(`Total Loss: Rs. ${totalLoss}`, margin.left, currentY + 24);
       doc.text(`Listed Sale Items: ${reportSalesItemCount}`, margin.left, currentY + 30);
       doc.text(`Listed Purchase Items: ${reportPurchasesItemCount}`, margin.left, currentY + 36);

       const rightX = 110;
       const rightX2 = 180;
       doc.setFont('helvetica', 'bold');
       doc.text("Sales Pyts:", rightX, currentY);
       doc.text("Purchases Pyts:", rightX2, currentY);
       doc.setFont('helvetica', 'normal');
       
       let pyS = currentY + 6;
       let pyP = currentY + 6;
       Object.entries(salesPaymentTotals).forEach(([mode, amount]) => {
         if (amount > 0) { doc.text(`${mode}: Rs. ${amount}`, rightX, pyS); pyS += 6; }
       });
       Object.entries(purchasePaymentTotals).forEach(([mode, amount]) => {
         if (amount > 0) { doc.text(`${mode}: Rs. ${amount}`, rightX2, pyP); pyP += 6; }
       });

       currentY = Math.max(currentY + 42, pyS, pyP) + 12;

       if (salesTx.length > 0) {
         doc.setFontSize(14);
         doc.text("Sales Ledger", margin.left, currentY);
         const sHeaders = ["No.", "Date", "Customer & Item", "Purchase Price", "Sell Price", "Profit", "Payments", "Status"];
         const sRows = salesTx.map((tx, idx) => {
             const custItem = getTxItems(tx).map(it => {
                 let res = tx.partyName && tx.partyName !== '-' ? `${tx.partyName}\n` : '';
                 res += `${it.productName}\nIMEI-${it.imeiNo}`;
                 if (tx.gift) res += `\nGift: ${tx.gift}`;
                 if (tx.remark) res += `\nMsg: ${tx.remark}`;
                 return res;
             }).join('\n\n');
             const purPrices = getTxItems(tx).map(it => {
                 let res = tx.partyName && tx.partyName !== '-' ? '\n' : '';
                 res += `Rs. ${it.purchasePrice}`;
                 if (tx.gift) res += '\n';
                 if (tx.remark) res += '\n';
                 return res;
             }).join('\n\n');
             const sellPrices = getTxItems(tx).map(it => {
                 let res = tx.partyName && tx.partyName !== '-' ? '\n' : '';
                 res += `Rs. ${it.sellingPrice || (it as any).sellPrice || 0}`;
                 if (tx.gift) res += '\n';
                 if (tx.remark) res += '\n';
                 return res;
             }).join('\n\n');
             
             const purPriceTotal = getTxTotalPurchase(tx);
             const sellPriceTotal = getTxTotalSelling(tx);
             return [
                 idx + 1, tx.date, custItem, purPrices, sellPrices, `Rs. ${sellPriceTotal - purPriceTotal}`, 
                 tx.paymentRecords.map(p => `${p.mode}:\nRs. ${p.amount}`).join('\n\n'), tx.paymentStatus
             ];
         });
         autoTable(doc, { head: [sHeaders], body: sRows, startY: currentY + 4, margin, styles: { cellWidth: 'auto', fontSize: 9, minCellHeight: 15, valign: 'top', overflow: 'linebreak' }, headStyles: { fillColor: [79, 70, 229] }, columnStyles: { 2: { cellWidth: 70 } } });
         currentY = (doc as any).lastAutoTable.finalY + 15;
       }

       if (purchaseTx.length > 0) {
         doc.setFontSize(14);
         doc.text("Purchases Ledger", margin.left, currentY);
         const pHeaders = ["No.", "Date", "Vendor & Item", "Pur. Price", "Payments", "Status"];
         const pRows = purchaseTx.map((tx, idx) => {
             const custItem = getTxItems(tx).map(it => {
                 let res = tx.partyName && tx.partyName !== '-' ? `${tx.partyName}\n` : '';
                 res += `${it.productName}\nIMEI-${it.imeiNo}`;
                 if (tx.remark) res += `\nMsg: ${tx.remark}`;
                 return res;
             }).join('\n\n');
             const purPrices = getTxItems(tx).map(it => {
                 let res = tx.partyName && tx.partyName !== '-' ? '\n' : '';
                 res += `Rs. ${it.purchasePrice}`;
                 if (tx.remark) res += '\n';
                 return res;
             }).join('\n\n');
             return [
                 idx + 1, tx.date, custItem, purPrices, 
                 tx.paymentRecords.map(p => `${p.mode}:\nRs. ${p.amount}`).join('\n\n'), tx.paymentStatus
             ];
         });
         autoTable(doc, { head: [pHeaders], body: pRows, startY: currentY + 4, margin, styles: { cellWidth: 'auto', fontSize: 9, minCellHeight: 15, valign: 'top', overflow: 'linebreak' }, headStyles: { fillColor: [16, 185, 129] }, columnStyles: { 2: { cellWidth: 90 } } });
         currentY = (doc as any).lastAutoTable.finalY + 15;
       }

       if (pendingSalesDues.length > 0 || pendingPurchaseDues.length > 0) {
          doc.setFontSize(14);
          doc.text("Pending Dues Ledger", margin.left, currentY);
          
          const duesCol = ["Role", "Customer / Vendor Name", "Due Amount"];
          const duesRows: any[] = [];
          pendingSalesDues.forEach(d => duesRows.push(["Sale (Receive)", d.name, `Rs. ${d.due}`]));
          pendingPurchaseDues.forEach(d => duesRows.push(["Purchase (Given)", d.name, `Rs. ${d.due}`]));

          autoTable(doc, { head: [duesCol], body: duesRows, startY: currentY + 4, margin, styles: { cellWidth: 'auto', fontSize: 9, overflow: 'linebreak' }, headStyles: { fillColor: [239, 68, 68] } });
          currentY = (doc as any).lastAutoTable.finalY + 15;
       }
    } else if (reportType === 'CashReport') {
       doc.setFontSize(14);
       doc.text(`Cash Tracker Ledger`, margin.left, currentY);
       
       let cInTotal = 0, cOutTotal = 0;
       const cRows: any[] = [];
       filteredTx.forEach(tx => {
           let inAmt = 0, outAmt = 0;
           let desc = tx.partyName || '-';
           
           if (tx.type === 'Cash In') {
               const parts = desc.split('|||');
               inAmt = tx.paymentRecords[0]?.amount || 0;
               desc = `Cash Given By:\n${parts[0] || '-'}\nRecv: ${parts[1] || '-'}`;
           } else if (tx.type === 'Cash Out') {
               const parts = desc.split('|||');
               outAmt = tx.paymentRecords[0]?.amount || 0;
               desc = `Cash Sent To:\n${parts[1] || '-'}\nGiver: ${parts[0] || '-'}`;
           } else {
               const cashP = tx.paymentRecords.reduce((sum, p) => p.mode === 'Cash' ? sum + p.amount : sum, 0);
               if (cashP > 0) {
                   if (tx.type === 'Sale' || tx.type === 'Advance') { inAmt = cashP; desc = `${tx.type} from:\n${desc}`; }
                   if (tx.type === 'Purchase') { outAmt = cashP; desc = `${tx.type} to:\n${desc}`; }
               }
           }

           if (tx.remark) desc += `\nMsg: ${tx.remark}`;

           if (inAmt > 0 || outAmt > 0) {
               cInTotal += inAmt;
               cOutTotal += outAmt;
               cRows.push([tx.date, tx.type === 'Sale' || tx.type === 'Purchase' || tx.type === 'Advance' ? `${tx.type} (Cash Auth)` : tx.type, desc, inAmt > 0 ? `Rs. ${inAmt}` : '-', outAmt > 0 ? `Rs. ${outAmt}` : '-']);
           }
       });
       
       currentY += 8;
       doc.setFontSize(11);
       doc.text(`Total Cash IN (Debit): Rs. ${cInTotal}`, margin.left, currentY);
       doc.text(`Total Cash OUT (Credit): Rs. ${cOutTotal}`, margin.left, currentY + 6);
       doc.text(`Net Cash Balance: Rs. ${cInTotal - cOutTotal}`, margin.left, currentY + 12);
       
       autoTable(doc, { head: [["Date", "Type", "Party / Details", "Debit (IN)", "Credit (OUT)"]], body: cRows, startY: currentY + 18, margin, styles: { cellWidth: 'auto', fontSize: 9, overflow: 'linebreak' }, headStyles: { fillColor: [59, 130, 246] }, columnStyles: { 2: { cellWidth: 100 } } });
    } else if (reportType === 'ItemsReport') {
       doc.setFontSize(14);
       doc.text(`Inventory Items Ledger`, margin.left, currentY);
       
       const activeDateFiltered = parsedData.activeProducts.filter(p => reportFilter === 'All' || (reportFilter === 'Today' && p.purchaseDate === new Date().toISOString().split('T')[0]) || (reportFilter === 'Yesterday' && p.purchaseDate === new Date(Date.now() - 86400000).toISOString().split('T')[0]) || (reportFilter === 'SpecificDate' && p.purchaseDate === reportSpecificDate) || (reportFilter === 'Month' && p.purchaseDate?.startsWith(reportMonth)));
       
       const inactiveDateFiltered = parsedData.inactiveProducts.filter(p => reportFilter === 'All' || (reportFilter === 'Today' && p.soldDate === new Date().toISOString().split('T')[0]) || (reportFilter === 'Yesterday' && p.soldDate === new Date(Date.now() - 86400000).toISOString().split('T')[0]) || (reportFilter === 'SpecificDate' && p.soldDate === reportSpecificDate) || (reportFilter === 'Month' && p.soldDate?.startsWith(reportMonth)));
       
       currentY += 8;
       doc.setFontSize(11);
       doc.text(`Active Items Count: ${activeDateFiltered.length}`, margin.left, currentY);
       doc.text(`Inactive (Sold) Items Count: ${inactiveDateFiltered.length}`, margin.left, currentY + 6);
       
       currentY += 12;
       if (activeDateFiltered.length > 0) {
           doc.setFontSize(12);
           doc.text(`Active Options`, margin.left, currentY);
           const aRows = activeDateFiltered.map(it => [it.purchaseDate, it.productName, it.imeiNo, `Rs. ${it.purchasePrice}`]);
           autoTable(doc, { head: [["Purchase Date", "Product Name", "IMEI No", "Purchase Price"]], body: aRows, startY: currentY + 4, margin, styles: { cellWidth: 'auto', fontSize: 9, overflow: 'linebreak' }, headStyles: { fillColor: [16, 185, 129] }, columnStyles: { 1: { cellWidth: 80 } } });
           currentY = (doc as any).lastAutoTable.finalY + 10;
       }
       if (inactiveDateFiltered.length > 0) {
           doc.setFontSize(12);
           doc.text(`Inactive / Sold Options`, margin.left, currentY);
           const iRows = inactiveDateFiltered.map(it => [it.soldDate || it.purchaseDate, it.productName, it.imeiNo, `Rs. ${it.purchasePrice}`, `Rs. ${it.sellingPrice || (it as any).sellPrice || 0}`]);
           autoTable(doc, { head: [["Sold Date", "Product Name", "IMEI No", "Purchase Price", "Selling Price"]], body: iRows, startY: currentY + 4, margin, styles: { cellWidth: 'auto', fontSize: 9, overflow: 'linebreak' }, headStyles: { fillColor: [239, 68, 68] }, columnStyles: { 1: { cellWidth: 80 } } });
       }
    }
    
    setReportModalOpen(false);

    const formatDDMMYYYY = (ds: string) => {
      if (!ds) return "";
      const [y, m, d] = ds.split('-');
      return `${d}/${m}/${y}`;
    };

    let periodStr = "";
    if (reportFilter === 'Today') periodStr = formatDDMMYYYY(new Date().toISOString().split('T')[0]);
    else if (reportFilter === 'Yesterday') {
      const yest = new Date(); yest.setDate(yest.getDate() - 1);
      periodStr = formatDDMMYYYY(yest.toISOString().split('T')[0]);
    }
    else if (reportFilter === 'SpecificDate') periodStr = formatDDMMYYYY(reportSpecificDate);
    else if (reportFilter === 'Month') periodStr = reportMonth; // e.g. 2026-04
    else periodStr = "All-Time";

    const reportTypeName = reportType === 'SalesPurchases' ? 'profit-loss-report' : 
                          reportType === 'AllDetails' ? 'all-details-report' :
                          reportType === 'CashReport' ? 'cash-ledger-report' : 'inventory-report';

    const reportFileName = `${periodStr}-${reportTypeName}`.replace(/\//g, '-');
    doc.save(`${reportFileName}.pdf`);
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

  const parsedData = useMemo(() => {



    const sortedTx = [...transactions].sort((a,b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateA !== dateB) return dateA - dateB;
      // If same date, Purchases come before Sales
      if (a.type === 'Purchase' && b.type === 'Sale') return -1;
      if (a.type === 'Sale' && b.type === 'Purchase') return 1;
      return 0;
    });
    
    // 1. Identify Day 1
    const day1Date = sortedTx.length > 0 ? sortedTx[0].date : null;

    const filterStartDate = (() => {
        if (dashboardFilter === 'Today') return new Date().toISOString().split('T')[0];
        if (dashboardFilter === 'Yesterday') {
           const d = new Date(); d.setDate(d.getDate() - 1);
           return d.toISOString().split('T')[0];
        }
        if (dashboardFilter === 'SpecificDate') return dashSpecificDate;
        if (dashboardFilter === 'Month') return `${dashMonth}-01`;
        return '0000-00-00';
    })();

    const isFilterMatch = (d: string) => {
        if (dashboardFilter === 'Today') return d === new Date().toISOString().split('T')[0];
        if (dashboardFilter === 'Yesterday') {
           const yesterday = new Date();
           yesterday.setDate(yesterday.getDate() - 1);
           return d === yesterday.toISOString().split('T')[0];
        }
        if (dashboardFilter === 'SpecificDate') return d === dashSpecificDate;
        if (dashboardFilter === 'Month') return d.startsWith(dashMonth);
        return true;
    };
    
    const isBeforeFilter = (d: string) => {
        return d < filterStartDate;
    };

    // 2. Reference Point: April 12, 2026 = ₹45,54,899 (Closing of April 11 handwritten records)
    // Formula: Closing = Opening + Purchases - (Sales - Profit)
    // NOTE: Sales - Profit = Cost of Sold items.
    // So: Closing = Opening + Purchases - CostOfSold
    const REFERENCE_DATE = '2026-04-12';
    const REFERENCE_OPENING_BALANCE = 4554899;

    // Accumulators for Balance
    let cumulativePurchasesBefore = 0;
    let periodPurchases = 0;
    let cumulativeCostOfSoldBefore = 0;
    let periodCostOfSold = 0;

    // Accumulators for Profit & Others
    let cumulativeProfitBefore = 0;
    let periodProfit = 0;

    // Tracker for stats cards
    let filteredSalesTotal = 0, filteredPurchasesTotal = 0;
    let filteredCashIn = 0, filteredCashOut = 0;
    let todaySalesCount = 0, todayPurchasesCount = 0;

    const inventoryTracker = new Map<string, any>(); 
    const giftTracker = new Map<string, {in: number, out: number}>();
    const modelTracker = new Map<string, number>();
    const advancesMap = new Map<string, TransactionRecord>();

    sortedTx.forEach(tx => {
      const txPur = getTxTotalPurchase(tx);
      const txSell = getTxTotalSelling(tx);
      const isToday = tx.date === new Date().toISOString().split('T')[0];
      const isMatch = isFilterMatch(tx.date);
      const isBefore = isBeforeFilter(tx.date);
      
      const txCashInTotal = tx.isExcluded ? 0 : tx.paymentRecords.reduce((sum, p) => p.mode === 'Cash' ? sum + p.amount : sum, 0);

      // Financial Tracking (Only for records after reference date)
      if (tx.date >= REFERENCE_DATE) {
          const txCostOfSold = (tx.type === 'Sale') ? txPur : 0;
          const txPurchasedActual = (tx.type === 'Purchase') ? txPur : 0;

          if (isBefore) {
              cumulativePurchasesBefore += txPurchasedActual;
              cumulativeCostOfSoldBefore += txCostOfSold;
          }
          if (isMatch) {
              periodPurchases += txPurchasedActual;
              periodCostOfSold += txCostOfSold;
          }

          // Profit Calculation
          if (tx.type === 'Sale') {
             const currentTxProfit = txSell - txPur;
             if (isBefore) cumulativeProfitBefore += currentTxProfit;
             if (isMatch) periodProfit += currentTxProfit;
          }
      }

      // Inventory Tracking (Always run for all records to maintain stock)
      if (tx.type === 'Purchase') {
        getTxItems(tx).forEach(it => {
            const status = it.statusOverride || 'ACTIVE';
            inventoryTracker.set(it.imeiNo, { ...it, status, purchaseDate: tx.date, purchaseTxId: tx.id });
        });
        if (isMatch && tx.date >= REFERENCE_DATE) {
            filteredPurchasesTotal += txPur;
            filteredCashOut += txCashInTotal;
            if (isToday) todayPurchasesCount += getTxItems(tx).length;
        }
      } else if (tx.type === 'Sale') {
        getTxItems(tx).forEach(it => {
            const existing = inventoryTracker.get(it.imeiNo) || {};
            const status = it.statusOverride || 'INACTIVE';
            inventoryTracker.set(it.imeiNo, { 
              ...existing, 
              ...it, 
              status, 
              soldDate: tx.date, 
              saleTxId: tx.id, 
              purchasePrice: existing.purchasePrice || it.purchasePrice,
              purchaseTxId: existing.purchaseTxId 
            });
        });
        if (isMatch && tx.date >= REFERENCE_DATE) {
            filteredSalesTotal += txSell;
            filteredCashIn += txCashInTotal;
            if (isToday) todaySalesCount += getTxItems(tx).length;
            
            getTxItems(tx).forEach(it => {
               modelTracker.set(it.productName, (modelTracker.get(it.productName) || 0) + 1);
            });
            if (tx.gift) {
               const g = giftTracker.get(tx.gift) || {in: 0, out: 0};
               g.out += 1;
               giftTracker.set(tx.gift, g);
            }
        }
      } else if (tx.type === 'Cash In') {
         if (isMatch && tx.date >= REFERENCE_DATE) filteredCashIn += txCashInTotal;
      } else if (tx.type === 'Cash Out') {
         if (isMatch && tx.date >= REFERENCE_DATE) filteredCashOut += txCashInTotal;
      } else if (tx.type === 'Advance') {
         advancesMap.set(tx.id, tx);
         if (isMatch && tx.date >= REFERENCE_DATE) filteredCashIn += txCashInTotal;
      } else if (tx.type === 'Opening Balance') {
         if (isMatch && tx.date >= REFERENCE_DATE) filteredCashIn += txCashInTotal;
      }
    });

    // Opening Balance (Day n) = Reference Balance + Cumulative (Purchases - CostSold) until Day n-1
    const openingBalance = REFERENCE_OPENING_BALANCE + cumulativePurchasesBefore - cumulativeCostOfSoldBefore;
    // Closing Balance (Day n) = Opening Balance + (Purchases - CostSold) during that day/period
    const closingBalance = openingBalance + periodPurchases - periodCostOfSold;

    const activeProducts = Array.from(inventoryTracker.values()).filter(p => p.status === 'ACTIVE');
    const inactiveProducts = Array.from(inventoryTracker.values()).filter(p => p.status === 'INACTIVE');
    const totalProductStockPrice = activeProducts.reduce((sum, p) => sum + p.purchasePrice, 0);

    const activeBrandCounts = activeProducts.reduce((acc, p) => {
      const brand = p.productName.trim().split(/\s+|-/)[0].toUpperCase();
      if (brand) {
        acc[brand] = (acc[brand] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    return {
      cards: [
        { label: 'Total Sales (Filtered)', value: `₹${filteredSalesTotal.toLocaleString()}`, icon: '💰', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
        { label: 'Total Purchases (Filtered)', value: `₹${filteredPurchasesTotal.toLocaleString()}`, icon: '📦', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
        { label: 'Net Cash In Hand (Filtered)', value: `₹${Math.max(0, filteredCashIn - filteredCashOut).toLocaleString()}`, icon: '💵', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
        { label: 'Cash IN (Filtered)', value: `₹${filteredCashIn.toLocaleString()}`, icon: '⬇️', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
        { label: 'Cash OUT (Filtered)', value: `₹${filteredCashOut.toLocaleString()}`, icon: '⬆️', color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-900/20' },
        { label: 'Active Inventory Stock', value: activeProducts.length.toString(), icon: '🏷️', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
      ],
      details: { totalDebit: 0, totalCredit: 0, openingBalance, closingBalance, totalProfit: periodProfit, totalLoss: 0, filteredCashIn, filteredCashOut, filteredSalesTotal, filteredPurchasesTotal },
      activeProducts, inactiveProducts, totalProductStockPrice, activeAdvances: Array.from(advancesMap.values()), gifts: Array.from(giftTracker.entries()), modelsSold: Array.from(modelTracker.entries()), activeBrandCounts,
      monthlyData: (() => {
         const allMonths = Array.from(new Set(sortedTx.map(t => t.date.slice(0, 7)))).sort();
         const data: any[] = [];
         
         let runningBalance = REFERENCE_OPENING_BALANCE;

         allMonths.filter(m => m >= REFERENCE_DATE.slice(0, 7)).forEach(m => {
            const monthTx = sortedTx.filter(t => t.date.startsWith(m) && t.date >= REFERENCE_DATE);
            let mSalesValue = 0, mPurchasesValue = 0;
            let mProfit = 0, mCostOfSold = 0;

            monthTx.forEach(tx => {
               const txPur = getTxTotalPurchase(tx);
               const txSell = getTxTotalSelling(tx);

               if (tx.type === 'Sale') {
                  mSalesValue += txSell;
                  mProfit += (txSell - txPur);
                  mCostOfSold += txPur;
               } else if (tx.type === 'Purchase') {
                  mPurchasesValue += txPur;
               }
            });

            const opening = runningBalance;
            // Balance Formula: Closing = Opening + Purchases - CostOfSold
            runningBalance = runningBalance + mPurchasesValue - mCostOfSold;
            
            data.push({ month: m, opening, closing: runningBalance, sales: mSalesValue, purchases: mPurchasesValue, profit: mProfit });
         });
         return data.reverse();
      })()
    };
  }, [transactions, dashboardFilter, dashSpecificDate, dashMonth]);

  const stats = { cards: parsedData.cards, details: parsedData.details };
  const displayData = useMemo(() => {
     const applyDateFilter = (d: string) => {
        if (!d) return false;
        if (dashboardFilter === 'Today') return d === new Date().toISOString().split('T')[0];
        if (dashboardFilter === 'Yesterday') {
           const yesterday = new Date();
           yesterday.setDate(yesterday.getDate() - 1);
           return d === yesterday.toISOString().split('T')[0];
        }
        if (dashboardFilter === 'SpecificDate') return d === dashSpecificDate;
        if (dashboardFilter === 'Month') return d.startsWith(dashMonth);
        return true;
     };

     let list = activeTab === 'Sales' ? transactions.filter(t => t.type === 'Sale') : 
                activeTab === 'Purchases' ? transactions.filter(t => t.type === 'Purchase') : 
                activeTab === 'Advances' ? parsedData.activeAdvances : transactions;
     
     list = list.filter(t => applyDateFilter(t.date));

     let cash: any[] = [];
     let filteredAll = transactions.filter(t => applyDateFilter(t.date));
     filteredAll.forEach(tx => {
        if (tx.type === 'Cash In' || tx.type === 'Cash Out' || tx.type === 'Opening Balance') {
           const parts = (tx.partyName || '|||').split('|||');
           const amt = tx.paymentRecords[0]?.amount || 0;
           cash.push({ id: tx.id, date: tx.date, type: tx.type, giver: parts[0] || '-', receiver: parts[1] || '-', amount: amt, in: tx.type === 'Cash In' || tx.type === 'Opening Balance', remark: tx.remark, rawTx: tx });
        } else {
           const cashPaid = tx.paymentRecords.reduce((sum, p) => p.mode === 'Cash' ? sum + p.amount : sum, 0);
           if (cashPaid > 0) {
              if (tx.type === 'Sale' || tx.type === 'Advance') {
                 cash.push({ id: tx.id, date: tx.date, type: `${tx.type} (Cash Auth)`, giver: tx.partyName || '-', receiver: 'Self', amount: cashPaid, in: true, remark: tx.remark, rawTx: tx });
              } else if (tx.type === 'Purchase') {
                 cash.push({ id: tx.id, date: tx.date, type: `${tx.type} (Cash Auth)`, giver: 'Self', receiver: tx.partyName || '-', amount: cashPaid, in: false, remark: tx.remark, rawTx: tx });
              }
           }
        }
     });

     if (searchQuery) {
       const q = searchQuery.toLowerCase();
       list = list.filter(t => 
         (t.partyName && t.partyName.toLowerCase().includes(q)) ||
         (t.remark && t.remark.toLowerCase().includes(q)) ||
         getTxItems(t).some(it => it.productName.toLowerCase().includes(q) || it.imeiNo.toLowerCase().includes(q))
       );
       cash = cash.filter(c => 
         c.giver.toLowerCase().includes(q) || 
         c.receiver.toLowerCase().includes(q) || 
         (c.remark && c.remark.toLowerCase().includes(q)) || 
         c.type.toLowerCase().includes(q)
       );
     }

     const filterBySearch = (items: any[]) => {
        if (!searchQuery) return items;
        const low = searchQuery.toLowerCase();
        return items.filter(it => 
           it.productName.toLowerCase().includes(low) || 
           it.imeiNo.toLowerCase().includes(low)
        );
     };

     return { 
       list, 
       cash, 
       activeItems: filterBySearch(parsedData.activeProducts.filter(p => applyDateFilter(p.purchaseDate))),
       inactiveItems: filterBySearch(parsedData.inactiveProducts.filter(p => applyDateFilter(p.soldDate || p.purchaseDate)))
     };
  }, [transactions, activeTab, dashboardFilter, dashSpecificDate, dashMonth, parsedData.activeAdvances, parsedData.activeProducts, parsedData.inactiveProducts, searchQuery]);

  const displayList = displayData.list;


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
              
              {modalType === 'CashEntry' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Date</label>
                    <input required type="date" value={formDate} onChange={e => setFormDate(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Cash Type</label>
                    <select value={formCashType} onChange={e => setFormCashType(e.target.value as any)} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 cursor-pointer">
                      <option value="Cash In">Cash In (Receive)</option>
                      <option value="Cash Out">Cash Out (Send)</option>
                      <option value="Opening Balance">☀️ Daily Opening Balance</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1 text-blue-500">Amount (₹)</label>
                    <input required type="number" value={payAmount} onChange={e => setPayAmount(Number(e.target.value))} placeholder="Amount" className="w-full bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-700 rounded-lg px-4 py-2 outline-none focus:border-blue-500 font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Giver Name {formCashType === 'Cash In' && '*'}</label>
                    <input type="text" value={formGiverName} onChange={e => setFormGiverName(e.target.value)} required={formCashType === 'Cash In'} placeholder="Name of giver" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Receiver Name {formCashType === 'Cash Out' && '*'}</label>
                    <input type="text" value={formReceiverName} onChange={e => setFormReceiverName(e.target.value)} required={formCashType === 'Cash Out'} placeholder="Name of receiver" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">Date</label>
                    <input required type="date" value={formDate} onChange={e => setFormDate(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                  </div>
                  {remainingAmount > 0 && (
                    <div className="animate-in fade-in zoom-in duration-300">
                       <label className="block text-xs font-bold mb-1 text-rose-500">{modalType === 'Sale' ? 'Customer Name (Due)' : modalType === 'Advance' ? 'Customer Name' : 'Vendor Name (Due)'}</label>
                       <input type="text" value={formPartyName} onChange={e => setFormPartyName(e.target.value)} placeholder={`e.g. ${modalType === 'Advance' || modalType === 'Sale' ? 'John Doe' : 'Samsung Dist.'}`} className="w-full bg-rose-50 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-700 rounded-lg px-4 py-2 outline-none focus:border-rose-500" />
                    </div>
                  )}
                </div>
              )}

              {modalType !== 'CashEntry' && (
                <>
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
                            {modalType === 'Advance' && (
                              <div>
                                <label className="block text-xs font-semibold mb-1 text-slate-500">Advance Amount (₹)</label>
                                <input required type="number" value={item.sellingPrice} onChange={e => updateFormItem(idx, 'sellingPrice', Number(e.target.value))} placeholder="0.00" className="w-full bg-amber-50/30 border border-amber-200 rounded-lg px-4 py-2 outline-none focus:border-amber-500 font-mono" />
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
                </>
              )}

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
                 <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">{modalType === 'Advance' ? 'Address / Contact details' : 'Remarks / Notes'}</label>
                    <textarea value={formRemark} onChange={e => setFormRemark(e.target.value)} placeholder="Add any extra details, comments, address..." className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" rows={2}></textarea>
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

      {showMobileMenu && (
        <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setShowMobileMenu(false)} />
      )}
      {/* Sidebar */}
      <aside className={`w-64 bg-white dark:bg-[#1e293b] border-r border-slate-200 dark:border-slate-800 flex flex-col fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 lg:relative lg:translate-x-0 ${showMobileMenu ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:flex'}`}>
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
        
        <div className="p-4 flex flex-col gap-2">
           <div className="flex gap-2">
             <button onClick={() => openModal('Sale')} className="flex-1 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg transition-colors cursor-pointer text-center shadow-sm">
               + SALE
             </button>
             <button onClick={() => openModal('Purchase')} className="flex-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg transition-colors cursor-pointer text-center shadow-sm">
               + PURCHASE
             </button>
           </div>
           <div className="flex gap-2">
             <button onClick={() => openModal('Advance')} className="flex-1 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-lg transition-colors cursor-pointer text-center shadow-sm">
               ⭐ ADVANCE
             </button>
             <button onClick={() => openModal('CashEntry')} className="flex-1 text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg transition-colors cursor-pointer text-center shadow-sm">
               💵 CASH IN/OUT
             </button>
           </div>
           <button id="import-btn" onClick={handleBulkImport} className="w-full text-xs font-bold bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white py-2 rounded-lg transition-colors cursor-pointer mt-1">
             ⚡ IMPORT TXT
           </button>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-2">
          {['Dashboard', 'Sales', 'Purchases', 'Advances', 'Cash Tracker', 'Inventory', 'All Details'].map((item) => (
            <button
              key={item}
              onClick={() => { setActiveTab(item); setShowMobileMenu(false); }}
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
                  <label className="block text-xs font-semibold mb-2 text-slate-500">Report Type</label>
                  <div className="grid grid-cols-2 gap-2 mb-4 text-xs font-bold">
                     <button onClick={() => setReportType('SalesPurchases')} className={`py-2 px-3 rounded-lg border transition ${reportType === 'SalesPurchases' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>Sales & Purc.</button>
                     <button onClick={() => setReportType('AllDetails')} className={`py-2 px-3 rounded-lg border transition ${reportType === 'AllDetails' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>All Details</button>
                     <button onClick={() => setReportType('CashReport')} className={`py-2 px-3 rounded-lg border transition ${reportType === 'CashReport' ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>Cash Ledger</button>
                     <button onClick={() => setReportType('ItemsReport')} className={`py-2 px-3 rounded-lg border transition ${reportType === 'ItemsReport' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>Items Inventory</button>
                  </div>
               </div>

               <div>
                  <label className="block text-xs font-semibold mb-2 text-slate-500">Report Period</label>
                  <div className="grid grid-cols-2 gap-2 mb-4">
                     {['All', 'Today', 'Yesterday', 'Month', 'SpecificDate'].map(mode => (
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
        <header className="flex flex-col gap-4 mb-8 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">{activeTab} Overview</h1>
              <p className="text-slate-500 dark:text-slate-400 hidden sm:block">Inventory, Advances & Sales financial reports.</p>
            </div>
            <button onClick={() => setShowMobileMenu(true)} className="lg:hidden p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-xl">
              ☰
            </button>
          </div>
          
          <div className="flex flex-col xl:flex-row items-center gap-4 w-full">
            <div className="relative w-full xl:w-96">
               <input 
                 type="text" 
                 placeholder="Search all..." 
                 value={searchQuery}
                 onChange={e => setSearchQuery(e.target.value)}
                 className="w-full bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-10 py-2.5 outline-none focus:border-indigo-500 shadow-sm"
               />
               <span className="absolute left-3 top-2.5 text-slate-400 text-lg">🔍</span>
               {searchQuery && (
                 <button 
                   onClick={() => setSearchQuery('')} 
                   className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xs font-bold bg-slate-100 dark:bg-slate-700 rounded-full w-5 h-5 flex items-center justify-center cursor-pointer transition-colors"
                   title="Clear search"
                 >
                   ✕
                 </button>
               )}
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-2 bg-white dark:bg-slate-800 p-2 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 w-full xl:w-auto">
              <div className="flex flex-wrap sm:flex-nowrap items-center justify-center gap-2 px-2 sm:border-r border-slate-200 dark:border-slate-700 w-full sm:w-auto pb-2 sm:pb-0 relative z-10">
                <span className="text-xs font-bold text-slate-400">FILTER:</span>
                <select value={dashboardFilter} onChange={e => setDashboardFilter(e.target.value as any)} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm font-semibold outline-none w-full sm:w-auto cursor-pointer">
                  <option value="All">All Time</option>
                  <option value="Today">Today</option>
                  <option value="Yesterday">Yesterday</option>
                  <option value="Month">This Month</option>
                  <option value="SpecificDate">Specific Date</option>
                </select>
                {dashboardFilter === 'SpecificDate' && (
                  <input type="date" value={dashSpecificDate} onChange={e => setDashSpecificDate(e.target.value)} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none w-full sm:w-auto cursor-pointer" />
                )}
                {dashboardFilter === 'Month' && (
                  <input type="month" value={dashMonth} onChange={e => setDashMonth(e.target.value)} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm outline-none w-full sm:w-auto cursor-pointer" />
                )}
              </div>
              <button onClick={() => setReportModalOpen(true)} className="w-full sm:w-auto px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-bold rounded-lg hover:bg-indigo-100 cursor-pointer transition-colors flex items-center justify-center gap-2 whitespace-nowrap">
                <span>📄</span> Report
              </button>
            </div>
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
                   <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Cash Flow (Filtered Period)</h3>
                   <div className="space-y-4">
                      <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700">
                         <span className="text-slate-600 dark:text-slate-300 font-medium text-sm">Cash Received (In)</span>
                         <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xl font-mono">₹{stats.details.filteredCashIn.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700">
                         <span className="text-slate-600 dark:text-slate-300 font-medium text-sm">Cash Paid (Out)</span>
                         <span className="text-rose-600 dark:text-rose-400 font-bold text-xl font-mono">₹{stats.details.filteredCashOut.toLocaleString()}</span>
                      </div>
                   </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-xl border border-slate-200 dark:border-slate-700">
                   <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Balance Summary</h3>
                   <div className="space-y-4">
                      <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700">
                         <span className="text-slate-600 dark:text-slate-300 font-medium text-sm">Opening Balance<br/><span className="text-[10px] uppercase text-slate-400 font-bold">(Cumulative until start)</span></span>
                         <span className="text-indigo-600 dark:text-indigo-400 font-bold text-xl font-mono">₹{stats.details.openingBalance.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-lg shadow-sm border border-indigo-200 dark:border-indigo-800">
                         <span className="text-indigo-800 dark:text-indigo-300 font-bold text-sm">Closing Balance<br/><span className="text-[10px] uppercase opacity-70 font-bold">(Cumulative until end)</span></span>
                         <span className="text-indigo-700 dark:text-indigo-400 font-bold text-2xl font-mono tracking-tight">₹{stats.details.closingBalance.toLocaleString()}</span>
                      </div>
                   </div>
                </div>
             </div>

             <div className="bg-indigo-50 dark:bg-indigo-900/20 p-6 rounded-xl border border-indigo-100 dark:border-indigo-800">
                <h3 className="text-sm font-bold text-indigo-800 dark:text-indigo-400 uppercase tracking-wider mb-4">Profit & Loss (Filtered Period)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm">
                      <span className="font-medium text-sm text-slate-600 dark:text-slate-300">Net Profit</span>
                      <span className="text-emerald-500 font-bold text-xl font-mono">₹{stats.details.totalProfit.toLocaleString()}</span>
                   </div>
                   <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm">
                      <span className="font-medium text-sm text-slate-600 dark:text-slate-300">Total Margin</span>
                      <span className="text-indigo-500 font-bold text-xl font-mono">₹{stats.details.totalProfit.toLocaleString()}</span>
                   </div>
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8">
                <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-xl border border-blue-100 dark:border-blue-800">
                   <h3 className="text-sm font-bold text-blue-800 dark:text-blue-400 uppercase tracking-wider mb-4">Inventory Overview</h3>
                   <div className="space-y-4">
                      <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700">
                         <span className="font-medium text-sm text-slate-600 dark:text-slate-300">Total Active Products</span>
                         <span className="font-bold text-xl">{parsedData.activeProducts.length}</span>
                      </div>
                      <div className="flex justify-between items-center bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700">
                         <span className="font-medium text-sm text-slate-600 dark:text-slate-300">Total Stock Value</span>
                         <span className="font-bold text-xl font-mono text-blue-600 dark:text-blue-400">₹{parsedData.totalProductStockPrice.toLocaleString()}</span>
                      </div>
                   </div>
                </div>

                <div className="bg-pink-50 dark:bg-pink-900/20 p-6 rounded-xl border border-pink-100 dark:border-pink-800">
                   <h3 className="text-sm font-bold text-pink-800 dark:text-pink-400 uppercase tracking-wider mb-4">Gifts Tracked (Filtered)</h3>
                   {parsedData.gifts.length === 0 ? (
                     <div className="text-sm text-slate-500 italic p-4">No gifts recorded yet.</div>
                   ) : (
                     <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                        {parsedData.gifts.map(([name, counts], idx) => (
                           <div key={idx} className="flex justify-between items-center bg-white dark:bg-slate-800 p-3 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700">
                              <span className="font-medium text-sm text-slate-700 dark:text-slate-200">{name}</span>
                              <span className="text-pink-600 font-bold bg-pink-100 dark:bg-pink-900/40 px-2 py-1 rounded text-xs">{counts.out} Given</span>
                           </div>
                        ))}
                     </div>
                   )}
                </div>

                <div className="bg-purple-50 dark:bg-purple-900/20 p-6 rounded-xl border border-purple-100 dark:border-purple-800">
                   <h3 className="text-sm font-bold text-purple-800 dark:text-purple-400 uppercase tracking-wider mb-4">Models Sold (Filtered)</h3>
                   {parsedData.modelsSold.length === 0 ? (
                     <div className="text-sm text-slate-500 italic p-4">No models sold in this filter.</div>
                   ) : (
                     <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                        {parsedData.modelsSold.sort((a,b) => b[1] - a[1]).map(([name, count], idx) => (
                           <div key={idx} className="flex justify-between items-center bg-white dark:bg-slate-800 p-3 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700">
                              <span className="font-medium text-sm text-slate-700 dark:text-slate-200 truncate pr-2">{name}</span>
                              <span className="text-purple-600 font-bold bg-purple-100 dark:bg-purple-900/40 px-2 py-1 rounded text-xs">{count} Sold</span>
                           </div>
                        ))}
                     </div>
                   )}
                </div>
             </div>
             
             <div className="mt-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">📅 Monthly Financial History</h3>
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm">
                   <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 uppercase tracking-tighter text-[10px] font-bold">
                         <tr>
                            <th className="px-6 py-3">Month</th>
                            <th className="px-6 py-3">Opening Bal.</th>
                            <th className="px-6 py-3">Sales (Month)</th>
                            <th className="px-6 py-3">Purchases (Total)</th>
                            <th className="px-6 py-3">Margin Profit</th>
                            <th className="px-6 py-3">Closing Bal.</th>
                            <th className="px-6 py-3">Net Gain</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
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
                      </tbody>
                   </table>
                </div>
                 <p className="text-[10px] text-slate-400 mt-3 px-2 italic">* Balances calculated as: Reference Stock (Apr 1) + Purchases - Cost of Sold Items</p>
             </div>
          </div>
        ) : null}

        {(activeTab === 'Dashboard' || activeTab === 'Sales' || activeTab === 'Purchases' || activeTab === 'Advances') && (
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
                    displayList.map((tx, idx) => (
                      <tr key={tx.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors group">
                        <td className="px-6 py-4 align-top">
                          <div className="flex flex-col pt-1">
                            <span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{idx + 1}</span>
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

        {activeTab === 'Cash Tracker' && (
          <div className="flex flex-col gap-6 animate-in fade-in duration-300 flex-1">
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-2xl w-12 h-12 flex items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600">
                      ⬇️
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Total Cash IN</p>
                  <p className="text-3xl font-bold tracking-tight text-emerald-600">₹{parsedData.details.filteredCashIn.toLocaleString()}</p>
                </div>
                <div className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-2xl w-12 h-12 flex items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-500">
                      ⬆️
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Total Cash OUT</p>
                  <p className="text-3xl font-bold tracking-tight text-rose-500">₹{parsedData.details.filteredCashOut.toLocaleString()}</p>
                </div>
                <div className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-2xl w-12 h-12 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600">
                      💵
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Net Amount</p>
                  <p className="text-3xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400">₹{Math.max(0, parsedData.details.filteredCashIn - parsedData.details.filteredCashOut).toLocaleString()}</p>
                </div>
            </section>

            <div className="bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col flex-1">
               <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50 gap-4">
                 <h2 className="font-bold text-lg">Cash Operations Tracker</h2>
               </div>
               <div className="overflow-x-auto min-h-[300px]">
               <table className="w-full text-left whitespace-nowrap">
                 <thead>
                   <tr className="bg-slate-100/50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">
                     <th className="px-6 py-4">No./Date</th>
                     <th className="px-6 py-4">Type</th>
                     <th className="px-6 py-4">Giver / Receiver Name</th>
                     <th className="px-6 py-4 text-emerald-600">Debit (IN)</th>
                     <th className="px-6 py-4 text-rose-500">Credit (OUT)</th>
                     <th className="px-6 py-4 text-right">Action</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                   {displayData.cash.length === 0 ? (
                     <tr>
                       <td colSpan={6} className="py-12 text-center text-slate-500">No cash records found for this period.</td>
                     </tr>
                   ) : (
                     displayData.cash.map((c, idx) => (
                       <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors group">
                         <td className="px-6 py-4 align-top">
                           <div className="flex flex-col pt-1">
                             <span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">{idx + 1}</span>
                             <span className="text-xs text-slate-500">{c.date}</span>
                           </div>
                         </td>
                         <td className="px-6 py-4 align-top pt-5">
                             <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-tight ${c.in ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                               {c.type}
                             </span>
                         </td>
                         <td className="px-6 py-4 align-top">
                            <div className="flex flex-col gap-1 text-xs mt-1">
                               <div className="font-semibold text-slate-700 dark:text-slate-300">From: <span className="font-bold uppercase text-slate-500">{c.giver}</span></div>
                               <div className="font-semibold text-slate-700 dark:text-slate-300">To: <span className="font-bold uppercase text-slate-500">{c.receiver}</span></div>
                               {c.remark && <span className="text-[10px] text-slate-400 mt-1">"{c.remark}"</span>}
                            </div>
                         </td>
                         <td className="px-6 py-4 align-top pt-5 text-emerald-600 font-mono font-bold">{c.in ? `₹${c.amount}` : '-'}</td>
                         <td className="px-6 py-4 align-top pt-5 text-rose-500 font-mono font-bold">{!c.in ? `₹${c.amount}` : '-'}</td>
                         <td className="px-6 py-4 text-right align-top pt-5">
                           <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                               <button 
                                 onClick={async () => {
                                   if (!user) return alert("Please sign in.");
                                   const newStatus = !c.rawTx.isExcluded;
                                   const { error } = await supabase
                                     .from('transactions')
                                     .update({ is_excluded: newStatus })
                                     .eq('id', c.id)
                                     .eq('user_id', user.id);
                                   
                                   if (error) {
                                      alert("Failed to update: " + error.message);
                                   } else {
                                      loadTransactions();
                                   }
                                 }} 
                                 className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${c.rawTx.isExcluded ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100'}`}
                               >
                                 {c.rawTx.isExcluded ? '➕ Add' : '➖ Remove'}
                               </button>
                               <button onClick={() => openEditModal(c.rawTx)} className="text-xs text-indigo-500 hover:underline bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 font-semibold">View / Edit</button>
                               <button onClick={() => deleteTx(c.id)} className="text-xs text-rose-500 hover:underline bg-rose-50 px-2 py-0.5 rounded border border-rose-100 font-semibold">Delete</button>
                           </div>
                         </td>
                       </tr>
                     ))
                   )}
                 </tbody>
               </table>
             </div>
          </div>
        </div>
      )}

        {activeTab === 'Inventory' && (
          <div className="flex flex-col gap-6 animate-in fade-in duration-300 flex-1">
            <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-2xl w-12 h-12 flex items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600">
                      📦
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Total Active Products</p>
                  <p className="text-3xl font-bold tracking-tight text-emerald-600">{displayData.activeItems.length}</p>
                </div>

                <div className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-2xl w-12 h-12 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500">
                      🏷️
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Total Inactive (Sold) Products</p>
                  <p className="text-3xl font-bold tracking-tight text-slate-600 dark:text-slate-300">{displayData.inactiveItems.length}</p>
                </div>
            </section>

            <div className="bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col flex-1">
               <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row justify-between lg:items-center bg-slate-50/50 dark:bg-slate-800/50 gap-4">
                 <div className="flex items-center gap-4">
                   <h2 className="font-bold text-lg">Inventory Products</h2>
                   <div className="bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1 rounded-lg border border-emerald-100 dark:border-emerald-800">
                      <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 block">Total Active Stock Value</span>
                      <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300 font-mono">₹{parsedData.totalProductStockPrice.toLocaleString()}</span>
                   </div>
                   <div className="flex bg-slate-200 dark:bg-slate-700 p-1 rounded-lg text-sm font-bold">
                     <button onClick={() => { setItemTab('Active'); setSelectedInventory([]); }} className={`px-4 py-1.5 rounded-md transition ${itemTab === 'Active' ? 'bg-white dark:bg-slate-800 shadow-sm text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}`}>Active Items</button>
                     <button onClick={() => { setItemTab('Inactive'); setSelectedInventory([]); }} className={`px-4 py-1.5 rounded-md transition ${itemTab === 'Inactive' ? 'bg-white dark:bg-slate-800 shadow-sm text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>Inactive (Sold)</button>
                   </div>
                </div>

                <div className="flex justify-end w-full lg:w-auto">
                   {selectedInventory.length > 0 && (
                     <button 
                       onClick={async () => {
                          if (!confirm(`CAUTION: You are about to delete ${selectedInventory.length} inventory records. This action will also delete their original purchase transactions. Proceed?`)) return;
                          const toDelete = (itemTab === 'Active' ? displayData.activeItems : displayData.inactiveItems)
                            .filter(it => selectedInventory.includes(it.imeiNo))
                            .map(it => it.purchaseTxId)
                            .filter((v, i, a) => a.indexOf(v) === i);
                          
                          for (const tid of toDelete) {
                             await supabase.from('transactions').delete().eq('id', tid);
                          }
                          loadTransactions();
                          setSelectedInventory([]);
                       }}
                       className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-all shadow-sm flex items-center gap-2 whitespace-nowrap"
                     >
                       🗑️ Delete ({selectedInventory.length})
                     </button>
                   )}
                </div>
              </div>

              {itemTab === 'Active' && (
                <div className="flex flex-wrap gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/10">
                  {(() => {
                    const brandCounts: Record<string, number> = {};
                    displayData.activeItems.forEach(it => {
                      const brand = it.productName.trim().split(/\s+|-/)[0].toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
                      if (brand) brandCounts[brand] = (brandCounts[brand] || 0) + 1;
                    });
                    const entries = Object.entries(brandCounts);
                    return entries.length === 0 ? (
                      <span className="text-xs text-slate-400 italic">No brand data for current filters</span>
                    ) : (
                      entries.map(([brand, count]) => (
                        <div key={brand} className="flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full shadow-sm hover:ring-2 hover:ring-indigo-500 transition-all cursor-default">
                          <span className="text-[10px] font-bold text-slate-500 uppercase">{brand}</span>
                          <span className="w-5 h-5 flex items-center justify-center bg-indigo-600 text-white rounded-full text-[10px] font-black">{count}</span>
                        </div>
                      ))
                    );
                  })()}
                </div>
              )}
                
                <div className="overflow-x-auto min-h-[300px]">
               <table className="w-full text-left whitespace-nowrap">
                 <thead>
                   <tr className="bg-slate-100/50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-widest font-bold">
                     <th className="px-6 py-4 w-10">
                       <input 
                         type="checkbox" 
                         className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                         checked={selectedInventory.length > 0 && selectedInventory.length === (itemTab === 'Active' ? displayData.activeItems : displayData.inactiveItems).length}
                         onChange={(e) => {
                           if (e.target.checked) {
                             setSelectedInventory((itemTab === 'Active' ? displayData.activeItems : displayData.inactiveItems).map(it => it.imeiNo));
                           } else {
                             setSelectedInventory([]);
                           }
                         }}
                       />
                     </th>
                     <th className="px-6 py-4">{itemTab === 'Active' ? 'Purchase Date' : 'Sold Date'}</th>
                     <th className="px-6 py-4">Item Details</th>
                     <th className="px-6 py-4">Purchase Price</th>
                     {itemTab === 'Inactive' && <th className="px-6 py-4 text-emerald-600">Sold Price</th>}
                     <th className="px-6 py-4 text-right">Actions</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                   {(itemTab === 'Active' ? displayData.activeItems : displayData.inactiveItems).length === 0 ? (
                     <tr>
                       <td colSpan={5} className="py-12 text-center text-slate-500">No products found in this category.</td>
                     </tr>
                   ) : (
                     (itemTab === 'Active' ? displayData.activeItems : displayData.inactiveItems).map((it, idx) => (
                       <tr key={`${it.imeiNo}-${idx}`} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors group">
                         <td className="px-6 py-4 align-middle">
                            <input 
                              type="checkbox" 
                              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              checked={selectedInventory.includes(it.imeiNo)}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedInventory([...selectedInventory, it.imeiNo]);
                                else setSelectedInventory(selectedInventory.filter(id => id !== it.imeiNo));
                              }}
                            />
                         </td>
                         <td className="px-6 py-4 align-middle">
                           <span className="text-xs font-semibold text-slate-500">{itemTab === 'Active' ? it.purchaseDate : (it.soldDate || it.purchaseDate)}</span>
                         </td>
                         <td className="px-6 py-4 align-middle">
                            <div className="flex flex-col">
                               <span className="font-bold text-slate-700 dark:text-slate-200 text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{it.productName}</span>
                               <span className="text-[10px] font-mono p-0.5 mt-0.5 bg-slate-100 dark:bg-slate-800 rounded w-fit text-slate-500 tracking-tight">IMEI: {it.imeiNo}</span>
                            </div>
                         </td>
                         <td className="px-6 py-4 align-middle font-mono font-bold text-slate-600 dark:text-slate-400">₹{it.purchasePrice.toLocaleString()}</td>
                         {itemTab === 'Inactive' && <td className="px-6 py-4 align-middle font-mono font-bold text-emerald-600">₹{(it.sellingPrice || (it as any).sellPrice || 0).toLocaleString()}</td>}
                         <td className="px-6 py-4 text-right align-middle">
                            <div className="flex justify-end gap-2 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                               <button 
                                 onClick={async () => {
                                   if (!user) return alert("Please sign in.");
                                   const tid = itemTab === 'Active' ? it.purchaseTxId : it.saleTxId;
                                   const tx = transactions.find(t => t.id === tid);
                                   if (!tx) return;
                                   
                                   const updatedItems = getTxItems(tx).map(item => {
                                     if (item.imeiNo === it.imeiNo) {
                                       return { ...item, statusOverride: itemTab === 'Active' ? 'INACTIVE' : 'ACTIVE' };
                                     }
                                     return item;
                                   });
                                   
                                   const { error } = await supabase
                                     .from('transactions')
                                     .update({ items: updatedItems })
                                     .eq('id', tid)
                                     .eq('user_id', user.id);
                                     
                                   if (!error) {
                                     loadTransactions();
                                   } else {
                                     alert("Error updating status: " + error.message);
                                   }
                                 }}
                                 className={`text-[10px] font-bold px-3 py-1 rounded-md transition-all shadow-sm flex items-center gap-1 border ${itemTab === 'Active' ? 'text-rose-600 border-rose-200 hover:bg-rose-600 hover:text-white' : 'text-emerald-600 border-emerald-200 hover:bg-emerald-600 hover:text-white'}`}
                               >
                                 {itemTab === 'Active' ? '🔽 Inactive' : '🔼 Active'}
                               </button>
                               <button 
                                 onClick={() => {
                                   const tid = itemTab === 'Active' ? it.purchaseTxId : it.saleTxId;
                                   const tx = transactions.find(t => t.id === tid);
                                   if (tx) openEditModal(tx);
                                 }}
                                 className="text-[10px] font-bold text-indigo-600 hover:text-white hover:bg-indigo-600 border border-indigo-200 dark:border-indigo-800 px-3 py-1 rounded-md transition-all shadow-sm flex items-center gap-1"
                               >
                                 ✏️ Edit
                               </button>
                               <button 
                                 onClick={async () => {
                                   if (!confirm("Are you sure you want to delete this inventory record? This will also remove the original purchase data.")) return;
                                   const tid = itemTab === 'Active' ? it.purchaseTxId : it.saleTxId;
                                   if (!tid) return alert("Error: Could not find transaction ID for this item.");
                                   const { error } = await supabase.from('transactions').delete().eq('id', tid);
                                   if (error) alert("Error deleting: " + error.message);
                                   loadTransactions();
                                 }}
                                 className="text-[10px] font-bold text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-200 dark:border-rose-800 px-3 py-1 rounded-md transition-all shadow-sm flex items-center gap-1"
                               >
                                 🗑️ Delete
                               </button>
                            </div>
                         </td>
                       </tr>
                     ))
                   )}
                 </tbody>
               </table>
             </div>
          </div>
        </div>
      )}
      </main>
    </div>
  );
};

export default AccountantDashboard;
