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
  type: 'Sale' | 'Purchase' | 'Advance' | 'Cash In' | 'Cash Out' | 'Opening Balance' | 'Customer' | 'Vendor';
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
  
  // Contact details
  contactType?: 'Customer' | 'Vendor';
  phone?: string;
  email?: string;
  address?: string;
  address1?: string;
  address2?: string;
  country?: string;
  state?: string;
  pin?: string;
  fax?: string;
  idProofType?: string;
  idProofNo?: string;
  gstNo?: string;
  category?: string;
}

const getTxItems = (tx: TransactionRecord): TransactionItem[] => {
  if (tx.items && tx.items.length > 0) {
    return tx.items.filter(it => it.productName !== 'DISCOUNT_APPLIED' && it.productName !== 'DOC_TYPE');
  }
  return [{
    productName: tx.productName || '',
    imeiNo: tx.imeiNo || '',
    purchasePrice: tx.purchasePrice || 0,
    sellingPrice: tx.sellingPrice || 0
  }];
};

const getTxDiscount = (tx: TransactionRecord): number => {
  if (tx.items && tx.items.length > 0) {
    const discountItem = tx.items.find(it => it.productName === 'DISCOUNT_APPLIED');
    if (discountItem) return (discountItem as any).discountValue || 0;
  }
  return 0;
};

const getTxDocType = (tx: TransactionRecord): 'Bill' | 'Tax Invoice' | 'None' => {
  if (tx.items && tx.items.length > 0) {
    const docItem = tx.items.find(it => it.productName === 'DOC_TYPE');
    if (docItem) return docItem.imeiNo as any;
  }
  return 'None';
};

const getTxTotalPurchase = (tx: TransactionRecord) => getTxItems(tx).reduce((sum, item) => sum + item.purchasePrice, 0);
const getTxTotalSelling = (tx: TransactionRecord) => getTxItems(tx).reduce((sum, item) => sum + item.sellingPrice, 0);

const AccountantDashboard = () => {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [isBillingMenuOpen, setIsBillingMenuOpen] = useState(false);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [showPartySelect, setShowPartySelect] = useState(false);
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [isExistingCustomer, setIsExistingCustomer] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (saved) {
      setTheme(saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

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
  const [modalType, setModalType] = useState<'Sale' | 'Purchase' | 'Advance' | 'CashEntry' | 'Customer' | 'Vendor'>('Sale');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formPartyName, setFormPartyName] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formGift, setFormGift] = useState('');
  
  const [formCashType, setFormCashType] = useState<'Cash In' | 'Cash Out' | 'Opening Balance'>('Cash In');
  const [formGiverName, setFormGiverName] = useState('');
  const [formReceiverName, setFormReceiverName] = useState('');
  const [formContactPhone, setFormContactPhone] = useState('');
  const [formContactEmail, setFormContactEmail] = useState('');
  const [formContactAddress1, setFormContactAddress1] = useState('');
  const [formContactAddress2, setFormContactAddress2] = useState('');
  const [formContactCountry, setFormContactCountry] = useState('India');
  const [formContactState, setFormContactState] = useState('');
  const [formContactPin, setFormContactPin] = useState('');
  const [formContactFax, setFormContactFax] = useState('');
  const [formContactIdType, setFormContactIdType] = useState('None');
  const [viewingParty, setViewingParty] = useState<any>(null);
  const [formContactIdNo, setFormContactIdNo] = useState('');
  const [formContactGst, setFormContactGst] = useState('');
  const [formContactCategory, setFormContactCategory] = useState('');
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

  const [formDiscount, setFormDiscount] = useState<number | ''>('');
  const [checkoutStep, setCheckoutStep] = useState<'Form' | 'Bill' | 'Invoice'>('Form');
  const [pendingTxData, setPendingTxData] = useState<any>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

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
  }, 0) - (modalType === 'Sale' ? Number(formDiscount || 0) : 0);
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
    const prevValue = newItems[index][field as keyof typeof newItems[0]];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormItems(newItems);

    // IMEI Lookup Logic (Sale only)
    if (modalType === 'Sale' && field === 'imeiNo' && value && value !== prevValue) {
       // 1. Advance Detection
       const matchingAdv = parsedData.activeAdvances.find(adv => 
          getTxItems(adv).some(it => it.imeiNo === value)
       );
       
       if (matchingAdv) {
          const advItems = getTxItems(matchingAdv);
          const advItem = advItems.find(it => it.imeiNo === value);
          const advPaid = matchingAdv.paymentRecords.reduce((sum, p) => sum + p.amount, 0);

          if (confirm(`Found active Advance for this IMEI!\nCustomer: ${matchingAdv.partyName}\nAdvance Amount: ₹${advPaid}\n\nDo you want to add this amount to current Sale payments?`)) {
             setFormPayments(prev => [...prev, { mode: 'Cash', amount: advPaid }]);
             setFormPartyName(matchingAdv.partyName);
             if (advItem) {
                const updatedItems = [...newItems];
                updatedItems[index].productName = advItem.productName;
                updatedItems[index].purchasePrice = advItem.purchasePrice;
                setFormItems(updatedItems);
             }
             (window as any)._pendingAdvanceId = matchingAdv.id;
             alert("Advance added to payments. The old advance record will be removed upon saving this sale.");
             return;
          }
       }

       // 2. Inventory Autocomplete (If no advance found, or user declined advance)
       const matchingProduct = parsedData.activeProducts.find(p => p.imeiNo === value);
       if (matchingProduct) {
          const updatedItems = [...newItems];
          updatedItems[index].productName = matchingProduct.productName;
          updatedItems[index].purchasePrice = matchingProduct.purchasePrice;
          updatedItems[index].sellingPrice = matchingProduct.sellingPrice || '';
          setFormItems(updatedItems);
       }
    }

     // IMEI Lookup Logic (Purchase)
     if (modalType === 'Purchase' && field === 'imeiNo' && value && value !== prevValue) {
        const matchingProduct = [...parsedData.activeProducts, ...parsedData.inactiveProducts].find(p => p.imeiNo === value);
        if (matchingProduct) {
           const updatedItems = [...newItems];
           updatedItems[index].productName = matchingProduct.productName;
           updatedItems[index].sellingPrice = matchingProduct.sellingPrice || '';
           setFormItems(updatedItems);
        }
     }
    // Product Name Lookup Logic (Sale only) - Auto-fill IMEI if only one, or fill prices
    if (modalType === 'Sale' && field === 'productName' && value && value !== prevValue) {
       const matchingProducts = parsedData.activeProducts.filter(p => p.productName === value);
       if (matchingProducts.length > 0) {
          const updatedItems = [...newItems];
          updatedItems[index].purchasePrice = matchingProducts[0].purchasePrice;
          updatedItems[index].sellingPrice = matchingProducts[0].sellingPrice || '';
          if (matchingProducts.length === 1) {
             updatedItems[index].imeiNo = matchingProducts[0].imeiNo;
          } else {
             const currentImeiMatchesProduct = matchingProducts.some(p => p.imeiNo === updatedItems[index].imeiNo);
             if (!currentImeiMatchesProduct) {
                updatedItems[index].imeiNo = '';
             }
          }
          setFormItems(updatedItems);
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

    if (modalType === 'Customer' || modalType === 'Vendor') {

      if (formContactPhone && !/^\d+$/.test(formContactPhone.trim())) {
        alert('Mobile Number must contain only numbers. Text is not allowed.');
        return;
      }
      
      if (formContactPin && !/^\d+$/.test(formContactPin.trim())) {
        alert('PIN Code must contain only numbers. Text is not allowed.');
        return;
      }

      if (formContactIdType === 'Aadhar' && formContactIdNo && !/^\d+$/.test(formContactIdNo.trim())) {
        alert('Aadhar Number must contain only numbers. Text is not allowed.');
        return;
      }
    }
    
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
    } else if (modalType === 'Customer' || modalType === 'Vendor') {
       if (formContactEmail && formContactEmail.trim() !== '') {
          const duplicate = transactions.find(t => 
             t.type === modalType && 
             t.id !== editingId && 
             getTxItems(t)[0]?.email?.toLowerCase() === formContactEmail.trim().toLowerCase()
          );
          if (duplicate) {
             alert(`This Email (${formContactEmail}) is already registered to ${duplicate.type}: ${duplicate.partyName}.\nPlease use a different email ID.`);
             return;
          }
       }
       txData.type = modalType;
       txData.party_name = formPartyName;
       txData.items = [{
         productName: 'Contact Record',
         imeiNo: '-',
         purchasePrice: 0,
         sellingPrice: 0,
         contactType: modalType as 'Customer' | 'Vendor',
         phone: formContactPhone,
         email: formContactEmail,
         address1: formContactAddress1,
         address2: formContactAddress2,
         country: formContactCountry,
         state: formContactState,
         pin: formContactPin,
         fax: formContactFax,
         idProofType: formContactIdType,
         idProofNo: formContactIdNo,
         gstNo: formContactGst,
         category: formContactCategory
       }];
       txData.payment_records = [];
       txData.payment_status = 'Paid';
    } else {
       let status: 'Paid' | 'Partial' | 'Pending' = 'Pending';
       if (totalPaid >= totalCost && totalCost > 0) status = 'Paid';
       else if (totalPaid > 0) status = 'Partial';

       const mappedItems: TransactionItem[] = formItems.map(it => ({
         productName: it.productName,
         imeiNo: it.imeiNo,
         purchasePrice: Number(it.purchasePrice) || 0,
         sellingPrice: Number(it.sellingPrice) || 0
       }));

       const actualDiscount = Number(formDiscount) || 0;
       if (actualDiscount > 0) {
         mappedItems.push({
           productName: 'DISCOUNT_APPLIED',
           imeiNo: '-',
           purchasePrice: 0,
           sellingPrice: 0,
           discountValue: actualDiscount
         } as any);
       }

       txData.type = modalType;
       txData.party_name = formPartyName;
       txData.items = mappedItems;
       txData.payment_records = formPayments;
       txData.payment_status = status;
    }

    if (editingId) {
      txData.id = editingId;
    }

    if ((modalType === 'Sale' || modalType === 'Purchase') && checkoutStep === 'Form') {
       setPendingTxData(txData);
       setCheckoutStep('Bill');
       return;
    }

    await executeSaveTransaction(txData, modalType === 'Sale' ? (checkoutStep === 'Bill' ? 'Bill' : (checkoutStep === 'Invoice' ? 'Tax Invoice' : 'None')) : 'None');
  };

  const executeSaveTransaction = async (txData: any, docType: 'Bill' | 'Tax Invoice' | 'None' = 'None') => {
    if (docType !== 'None' && txData.type === 'Sale') {
      const newItems = [...(txData.items || [])];
      const existingIdx = newItems.findIndex(it => it.productName === 'DOC_TYPE');
      if (existingIdx >= 0) {
        newItems[existingIdx] = { ...newItems[existingIdx], imeiNo: docType };
      } else {
        newItems.push({ productName: 'DOC_TYPE', imeiNo: docType, purchasePrice: 0, sellingPrice: 0 });
      }
      txData.items = newItems;
    }

    if (txData.type === 'Sale' && (formContactPhone || formContactAddress1 || formContactIdNo)) {
       const existingCustomer = transactions.find(t => t.type === 'Customer' && t.partyName?.toLowerCase() === txData.party_name?.toLowerCase());
       const cItem: any = {
           productName: 'Contact Record',
           imeiNo: '-',
           purchasePrice: 0,
           sellingPrice: 0,
           contactType: 'Customer',
           phone: formContactPhone,
           address1: formContactAddress1,
           idProofType: formContactIdNo ? 'Aadhar' : 'None',
           idProofNo: formContactIdNo,
       };
       if (existingCustomer) {
           const existingItem = getTxItems(existingCustomer)[0];
           cItem.email = existingItem.email || formContactEmail;
           cItem.gstNo = existingItem.gstNo || formContactGst;
           cItem.address2 = existingItem.address2 || formContactAddress2;
           cItem.country = existingItem.country || formContactCountry;
           cItem.state = existingItem.state || formContactState;
           cItem.pin = existingItem.pin || formContactPin;
           cItem.fax = existingItem.fax || formContactFax;
           cItem.category = existingItem.category || formContactCategory;
       }
       const customerData: any = {
           user_id: txData.user_id,
           type: 'Customer',
           party_name: txData.party_name,
           date: txData.date,
           payment_records: [],
           payment_status: 'Paid',
           items: [cItem]
       };
       if (existingCustomer) customerData.id = existingCustomer.id;
       await supabase.from('transactions').upsert(customerData);
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


  const resetForm = () => {
    setFormPartyName('');
    setFormGiverName('');
    setFormReceiverName('');
    setFormPartyName('');
    setShowPartySelect(false);
    setIsExistingCustomer(false);
    setFormRemark('');
    setFormGift('');
    setFormItems([{ productName: '', imeiNo: '', purchasePrice: '', sellingPrice: '' }]);
    setFormDiscount('');
    setCheckoutStep('Form');
    setPendingTxData(null);
    setPdfPreviewUrl(null);
    setFormPayments([]);
    setPayAmount('');
    setEditingId(null);
    setFormCashType('Cash In');
    setFormContactPhone('');
    setFormContactEmail('');
    setFormContactAddress1('');
    setFormContactAddress2('');
    setFormContactCountry('India');
    setFormContactState('');
    setFormContactPin('');
    setFormContactFax('');
    setFormContactIdType('None');
    setFormContactIdNo('');
    setFormContactGst('');
    setFormContactCategory('');
  };

  const openModal = (type: 'Sale' | 'Purchase' | 'Advance' | 'CashEntry' | 'Customer' | 'Vendor') => {
    resetForm();
    setModalType(type as any);
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
    
    if (tx.type === 'Customer' || tx.type === 'Vendor') {
        setModalType(tx.type as any);
        setFormPartyName(tx.partyName || '');
        const item = getTxItems(tx)[0] || {} as any;
        setFormContactPhone(item.phone || '');
        setFormContactEmail(item.email || '');
        setFormContactAddress1(item.address1 || '');
        setFormContactAddress2(item.address2 || '');
        setFormContactCountry(item.country || 'India');
        setFormContactState(item.state || '');
        setFormContactPin(item.pin || '');
        setFormContactFax(item.fax || '');
        setFormContactIdType(item.idProofType || 'None');
        setFormContactIdNo(item.idProofNo || '');
        setFormContactGst(item.gstNo || '');
        setFormContactCategory(item.category || '');
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

  const handleView = (tx: TransactionRecord) => {
    const docType = getTxDocType(tx);
    if (tx.type === 'Sale') {
       setCheckoutStep(docType === 'Tax Invoice' ? 'Invoice' : 'Bill');
    } else {
       setCheckoutStep('Bill'); 
    }
    setPendingTxData(tx);
    setModalType(tx.type as any);
    setIsModalOpen(true);
  };

  const exportInvoice = async (rawTx: any, mode: 'Invoice' | 'Bill' | 'Combined', action: 'download' | 'print' | 'preview' = 'download') => {
    const tx: TransactionRecord = {
      ...rawTx,
      partyName: rawTx.partyName || rawTx.party_name,
      paymentRecords: rawTx.paymentRecords || rawTx.payment_records || [],
      paymentStatus: rawTx.paymentStatus || rawTx.payment_status || 'Pending'
    };
    const doc = new jsPDF({ orientation: 'portrait', format: 'a4' });
    
    // Unified Black Logo Helper
    const getBlackLogo = async () => {
      const logoUrl = '/logo.png';
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.src = logoUrl;
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      }
      return logoUrl;
    };

    let logoData: string | null = null;
    let logoAspect = 1;
    try {
      logoData = await getBlackLogo();
      const tempImg = new window.Image();
      tempImg.src = logoData;
      await new Promise(res => { tempImg.onload = res; });
      logoAspect = tempImg.width / tempImg.height;
    } catch (e) { console.warn("Logo failed", e); }

      const renderSinglePage = (pageMode: 'Invoice' | 'Bill') => {
        if (logoData) {
          doc.addImage(logoData, 'PNG', 14, 10, 12 * logoAspect, 12);
        }

        doc.setFontSize(22);
        doc.setTextColor(30, 41, 59);
        doc.text(pageMode === 'Invoice' ? 'TAX INVOICE' : 'BILL', 196, 20, { align: 'right' });
        
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text('Powered by Amvidis India', 196, 26, { align: 'right' });
        doc.text(`Date: ${tx.date}`, 196, 32, { align: 'right' });
        doc.text(`${pageMode} No: ${pageMode.toUpperCase().slice(0,3)}-${tx.id.substring(0,6).toUpperCase()}`, 196, 38, { align: 'right' });

        const customerTx = transactions.find(t => t.type === 'Customer' && t.partyName?.toLowerCase() === tx.partyName?.toLowerCase());
        const cItem = customerTx ? getTxItems(customerTx)[0] : null;

        doc.setFontSize(12);
        doc.setTextColor(30, 41, 59);
        doc.setFont('helvetica', 'bold');
        doc.text('Billed To:', 14, 50);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(11);
        doc.text(tx.partyName || 'Walk-in Customer', 14, 57);
        
        let yPos = 63;
        if (cItem) {
          if (cItem.phone) { doc.text(`Phone: ${cItem.phone}`, 14, yPos); yPos += 6; }
          if (cItem.email) { doc.text(`Email: ${cItem.email}`, 14, yPos); yPos += 6; }
          const address = [cItem.address1, cItem.address2, cItem.state, cItem.country, cItem.pin].filter(Boolean).join(', ');
          if (address) {
            const lines = doc.splitTextToSize(`Address: ${address}`, 80);
            doc.text(lines, 14, yPos);
            yPos += lines.length * 6;
          }
          if (pageMode === 'Invoice' && cItem.gstNo) {
            doc.setFont('helvetica', 'bold');
            doc.text(`GSTIN: ${cItem.gstNo}`, 14, yPos);
            doc.setFont('helvetica', 'normal');
          }
        }

        const items = getTxItems(tx);
        const isPurchase = tx.type === 'Purchase';
        const tableData = items.map((it, idx) => [
          idx + 1, it.productName || '-', it.imeiNo || '-', 1,
          `Rs. ${Number(isPurchase ? it.purchasePrice : it.sellingPrice || 0).toLocaleString()}`,
          `Rs. ${Number(isPurchase ? it.purchasePrice : it.sellingPrice || 0).toLocaleString()}`
        ]);

        const totalAmount = isPurchase ? getTxTotalPurchase(tx) : getTxTotalSelling(tx);
        const totalPaid = tx.paymentRecords.reduce((sum, p) => sum + p.amount, 0);
        const totalDue = totalAmount - getTxDiscount(tx) - totalPaid;

        autoTable(doc, {
          startY: Math.max(yPos + 10, 80),
          head: [['#', 'Item Description', 'IMEI/Serial', 'Qty', 'Rate', 'Amount']],
          body: tableData,
          theme: 'grid',
          headStyles: { 
            fillColor: [30, 41, 59], 
            textColor: [255, 255, 255], 
            fontStyle: 'bold',
            halign: 'center',
            valign: 'middle'
          },
          styles: { 
            fontSize: 9, 
            cellPadding: 4, 
            valign: 'middle' 
          },
          columnStyles: { 
            0: { cellWidth: 12, halign: 'center' }, 
            1: { halign: 'left' },
            2: { halign: 'center' },
            3: { cellWidth: 15, halign: 'center' }, 
            4: { halign: 'right' }, 
            5: { halign: 'right' } 
          }
        });

        const finalY = (doc as any).lastAutoTable.finalY + 10;
        doc.setFontSize(10);
        doc.text('Payment Status: ', 120, finalY);
        doc.setFont('helvetica', 'bold');
        if (tx.paymentStatus === 'Paid') doc.setTextColor(16, 185, 129);
        else if (tx.paymentStatus === 'Pending') doc.setTextColor(244, 63, 94);
        else doc.setTextColor(245, 158, 11);
        doc.text(tx.paymentStatus, 150, finalY);
        
        doc.setTextColor(30, 41, 59);
        doc.text('Subtotal:', 120, finalY + 8);
        doc.text(`Rs. ${totalAmount.toLocaleString()}`, 196, finalY + 8, { align: 'right' });
        
        const discount = getTxDiscount(tx);
        let nextY = finalY + 16;
        if (discount > 0) {
          doc.text('Discount:', 120, nextY);
          doc.setTextColor(16, 185, 129);
          doc.text(`- Rs. ${discount.toLocaleString()}`, 196, nextY, { align: 'right' });
          doc.setTextColor(30, 41, 59);
          nextY += 8;
          doc.setFont('helvetica', 'bold');
          doc.text('Grand Total:', 120, nextY);
          doc.text(`Rs. ${(totalAmount - discount).toLocaleString()}`, 196, nextY, { align: 'right' });
          doc.setFont('helvetica', 'normal');
          nextY += 8;
        }

        doc.text('Amount Paid:', 120, nextY);
        doc.text(`Rs. ${totalPaid.toLocaleString()}`, 196, nextY, { align: 'right' });

        if (totalDue > 0 && tx.type !== 'Purchase') {
          doc.text('Balance Due:', 120, nextY + 8);
          doc.setTextColor(225, 29, 72);
          doc.text(`Rs. ${totalDue.toLocaleString()}`, 196, nextY + 8, { align: 'right' });
        }

        doc.setTextColor(148, 163, 184);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text('Thank you for your business!', 105, 280, { align: 'center' });
      };

      if (mode === 'Combined') {
        renderSinglePage('Bill');
        doc.addPage();
        renderSinglePage('Invoice');
      } else {
        renderSinglePage(mode);
      }

      if (action === 'preview') return doc.output('datauristring');
      else if (action === 'print') {
        doc.autoPrint();
        window.open(doc.output('bloburl'), '_blank');
      } else {
        doc.save(`${mode}_${tx.partyName || 'Customer'}_${tx.date}.pdf`);
      }
    };

  useEffect(() => {
    if ((checkoutStep === 'Bill' || checkoutStep === 'Invoice') && pendingTxData) {
       exportInvoice({ ...pendingTxData, id: pendingTxData.id || 'DRAFT', date: pendingTxData.date }, checkoutStep === 'Bill' ? 'Bill' : 'Invoice', 'preview').then(url => {
          setPdfPreviewUrl(url as string);
       });
    } else {
       setPdfPreviewUrl(null);
    }
  }, [checkoutStep, pendingTxData]);

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

    const getBlackLogo = async () => {
      const logoUrl = '/logo.png';
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.src = logoUrl;
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      }
      return logoUrl;
    };

    try {
      const blackLogoData = await getBlackLogo();
      const img = new window.Image();
      img.src = blackLogoData;
      await new Promise((resolve) => { img.onload = resolve; });
      const aspect = img.width / img.height;
      const logoW = 10 * aspect;
      doc.addImage(img, 'PNG', margin.left, margin.top - 10, logoW, 10);
      doc.setFontSize(18);
      doc.text(`Amvidis India - ${reportTitleStr}`, margin.left + logoW + 5, margin.top - 1);
    } catch (e) {
      doc.setFontSize(18);
      doc.text(`Amvidis India - ${reportTitleStr}`, margin.left, margin.top);
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
       doc.text(`Total Loss: Rs. ${parsedData.details.totalLoss}`, margin.left, currentY + 42);
       
       let rightX = 140;
       doc.text(`Total Gifts Tracked:`, rightX, currentY);
       let gY = currentY + 6;
       parsedData.gifts.forEach(([name, counts]) => {
           doc.text(`- ${name}: ${counts.out} Given`, rightX, gY);
           gY += 6;
       });
       
       currentY = Math.max(currentY + 48, gY) + 10;
       
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
          autoTable(doc, { 
            head: [advHeaders], 
            body: advRows, 
            startY: currentY + 4, 
            margin, 
            styles: { 
              fontSize: 9, 
              valign: 'middle',
              overflow: 'linebreak' 
            }, 
            headStyles: { 
              fillColor: [245, 158, 11],
              halign: 'center',
              valign: 'middle'
            }, 
            columnStyles: { 
              1: { cellWidth: 50 }, 
              2: { cellWidth: 80 } 
            } 
          });
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
         const sHeaders = ["No.", "Date", "Customer & Item", "Purchase Price", "Sell Price", "Profit", "Loss", "Payments", "Status"];
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
             const diff = sellPriceTotal - purPriceTotal;
             const profitVal = diff > 0 ? `Rs. ${diff}` : '-';
             const lossVal = diff < 0 ? `Rs. ${Math.abs(diff)}` : '-';

             return [
                 idx + 1, tx.date, custItem, purPrices, sellPrices, profitVal, lossVal, 
                 tx.paymentRecords.map(p => `${p.mode}:\nRs. ${p.amount}`).join('\n\n'), tx.paymentStatus
             ];
         });
         autoTable(doc, { 
           head: [sHeaders], 
           body: sRows, 
           startY: currentY + 4, 
           margin, 
           styles: { 
             fontSize: 9, 
             minCellHeight: 12, 
             valign: 'middle', 
             overflow: 'linebreak' 
           }, 
           headStyles: { 
             fillColor: [79, 70, 229],
             halign: 'center',
             valign: 'middle'
           }, 
           columnStyles: { 
             0: { halign: 'center' },
             2: { cellWidth: 70 },
             3: { halign: 'right' },
             4: { halign: 'right' },
             5: { halign: 'right' },
             6: { halign: 'right' }
           } 
         });
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
         autoTable(doc, { 
           head: [pHeaders], 
           body: pRows, 
           startY: currentY + 4, 
           margin, 
           styles: { 
             fontSize: 9, 
             minCellHeight: 12, 
             valign: 'middle', 
             overflow: 'linebreak' 
           }, 
           headStyles: { 
             fillColor: [16, 185, 129],
             halign: 'center',
             valign: 'middle'
           }, 
           columnStyles: { 
             0: { halign: 'center' },
             2: { cellWidth: 90 },
             3: { halign: 'right' }
           } 
         });
         currentY = (doc as any).lastAutoTable.finalY + 15;
       }

       if (pendingSalesDues.length > 0 || pendingPurchaseDues.length > 0) {
          doc.setFontSize(14);
          doc.text("Pending Dues Ledger", margin.left, currentY);
          
          const duesCol = ["Role", "Customer / Vendor Name", "Due Amount"];
          const duesRows: any[] = [];
          pendingSalesDues.forEach(d => duesRows.push(["Sale (Receive)", d.name, `Rs. ${d.due}`]));
          pendingPurchaseDues.forEach(d => duesRows.push(["Purchase (Given)", d.name, `Rs. ${d.due}`]));

          autoTable(doc, { 
            head: [duesCol], 
            body: duesRows, 
            startY: currentY + 4, 
            margin, 
            styles: { 
              fontSize: 9, 
              valign: 'middle',
               overflow: 'linebreak' 
            }, 
            headStyles: { 
              fillColor: [239, 68, 68],
              halign: 'center',
              valign: 'middle'
            } 
          });
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
       
       autoTable(doc, { 
         head: [["Date", "Type", "Party / Details", "Debit (IN)", "Credit (OUT)"]], 
         body: cRows, 
         startY: currentY + 18, 
         margin, 
         styles: { 
           fontSize: 9, 
           valign: 'middle',
           overflow: 'linebreak' 
         }, 
         headStyles: { 
           fillColor: [59, 130, 246],
           halign: 'center',
           valign: 'middle'
         }, 
         columnStyles: { 
           2: { cellWidth: 100 },
           3: { halign: 'right' },
           4: { halign: 'right' }
         } 
       });
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
           autoTable(doc, { 
             head: [["Purchase Date", "Product Name", "IMEI No", "Purchase Price"]], 
             body: aRows, 
             startY: currentY + 4, 
             margin, 
             styles: { 
               fontSize: 9, 
               valign: 'middle',
               overflow: 'linebreak' 
             }, 
             headStyles: { 
               fillColor: [16, 185, 129],
               halign: 'center',
               valign: 'middle'
             }, 
             columnStyles: { 
               1: { cellWidth: 80 },
               2: { halign: 'center' },
               3: { halign: 'right' }
             } 
           });
           currentY = (doc as any).lastAutoTable.finalY + 10;
       }
       if (inactiveDateFiltered.length > 0) {
           doc.setFontSize(12);
           doc.text(`Inactive / Sold Options`, margin.left, currentY);
           const iRows = inactiveDateFiltered.map(it => [it.soldDate || it.purchaseDate, it.productName, it.imeiNo, `Rs. ${it.purchasePrice}`, `Rs. ${it.sellingPrice || (it as any).sellPrice || 0}`]);
           autoTable(doc, { 
             head: [["Sold Date", "Product Name", "IMEI No", "Purchase Price", "Selling Price"]], 
             body: iRows, 
             startY: currentY + 4, 
             margin, 
             styles: { 
               fontSize: 9, 
               valign: 'middle',
               overflow: 'linebreak' 
             }, 
             headStyles: { 
               fillColor: [239, 68, 68],
               halign: 'center',
               valign: 'middle'
             }, 
             columnStyles: { 
               1: { cellWidth: 80 },
               2: { halign: 'center' },
               3: { halign: 'right' },
               4: { halign: 'right' }
             } 
           });
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
    const REFERENCE_OPENING_BALANCE = 0;

    // Accumulators for Balance
    let cumulativePurchasesBefore = 0;
    let periodPurchases = 0;
    let cumulativeCostOfSoldBefore = 0;
    let periodCostOfSold = 0;

    // Accumulators for Profit & Others
    let cumulativeProfitBefore = 0;
    let periodProfit = 0;
    let periodLoss = 0;

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

          if (tx.type === 'Sale') {
             const currentTxProfit = txSell - txPur;
             if (isBefore) cumulativeProfitBefore += currentTxProfit;
             if (isMatch) {
                if (currentTxProfit > 0) periodProfit += currentTxProfit;
                else if (currentTxProfit < 0) periodLoss += Math.abs(currentTxProfit);
             }
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
        { label: 'Total Sales (Filtered)', value: `₹${filteredSalesTotal.toLocaleString()}`, icon: 'ri-money-dollar-circle-line', color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
        { label: 'Total Purchases (Filtered)', value: `₹${filteredPurchasesTotal.toLocaleString()}`, icon: 'ri-box-3-line', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
        { label: 'Net Cash In Hand (Filtered)', value: `₹${Math.max(0, filteredCashIn - filteredCashOut).toLocaleString()}`, icon: 'ri-wallet-3-line', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
        { label: 'Cash IN (Filtered)', value: `₹${filteredCashIn.toLocaleString()}`, icon: 'ri-arrow-down-circle-line', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
        { label: 'Cash OUT (Filtered)', value: `₹${filteredCashOut.toLocaleString()}`, icon: 'ri-arrow-up-circle-line', color: 'text-rose-500', bg: 'bg-rose-50 dark:bg-rose-900/20' },
        { label: 'Active Inventory Stock', value: activeProducts.length.toString(), icon: 'ri-price-tag-3-line', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20' },
      ],
      details: { totalDebit: 0, totalCredit: 0, openingBalance, closingBalance, totalProfit: periodProfit, totalLoss: periodLoss, filteredCashIn, filteredCashOut, filteredSalesTotal, filteredPurchasesTotal },
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
                activeTab === 'Advances' ? parsedData.activeAdvances : 
                activeTab === 'Customers' ? transactions.filter(t => t.type === 'Customer') :
                activeTab === 'Vendors' ? transactions.filter(t => t.type === 'Vendor') :
                activeTab === 'Bills' ? transactions.filter(t => t.type === 'Sale' && getTxDocType(t) === 'Bill') :
                 activeTab === 'Tax Invoices' ? transactions.filter(t => t.type === 'Sale' && getTxDocType(t) === 'Tax Invoice') :
                 activeTab === 'Billing & Invoices' ? transactions.filter(t => t.type === 'Sale') :
                transactions;
     
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


  const handleSearchParty = (nameOverride?: string) => {
    const nameToSearch = nameOverride || formPartyName;
    const targetType = modalType === 'Purchase' ? 'Vendor' : 'Customer';
    if (!nameToSearch) {
       if (!nameOverride) alert(`Please enter a ${targetType.toLowerCase()} name to search.`);
       return;
    }
    const party = transactions.find(t => t.type === targetType && t.partyName?.toLowerCase() === nameToSearch.toLowerCase());
    if (party) {
       const pItem = party.items && party.items.length > 0 ? party.items[0] : null;
       if (pItem) {
          setFormContactPhone(pItem.phone || '');
          setFormContactAddress1(pItem.address1 || '');
          setFormContactIdNo(pItem.idProofNo || '');
          if (targetType === 'Vendor' && pItem.gstNo) {
             setFormContactGst(pItem.gstNo);
          }
       }
       setIsExistingCustomer(true);
       alert(`${targetType} details fetched successfully!`);
    } else {
       setIsExistingCustomer(false);
       alert(`No existing ${targetType.toLowerCase()} found with this name.`);
    }
  };

  return (
    <div className={`flex min-h-screen font-sans transition-colors duration-300 ${theme === 'dark' ? 'dark bg-[#0f172a] text-slate-100' : 'bg-[#f8fafc] text-slate-900'}`}>
      
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className={`bg-white dark:bg-[#1e293b] rounded-2xl w-full ${checkoutStep === 'Form' ? 'max-w-2xl' : 'max-w-5xl'} shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 my-8 max-h-[95vh] flex flex-col transition-all duration-300`}>
            <div className={`p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center shrink-0 ${modalType === 'Sale' ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
              <h3 className="font-bold text-lg flex items-center gap-2">
                <i className={modalType === 'Sale' ? 'ri-price-tag-3-line text-indigo-600' : 'ri-box-3-line text-emerald-600'}></i> {editingId ? 'Edit' : 'New'} {modalType} Record
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer text-xl">✕</button>
            </div>
            
            {checkoutStep === 'Form' ? (
              <form onSubmit={handleAddTransaction} className="p-6 overflow-y-auto flex-1 space-y-6">
              
              {modalType === 'Customer' || modalType === 'Vendor' ? (
                <div className="space-y-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-slate-500">{modalType === 'Customer' ? 'Customer' : 'Vendor'} Name</label>
                    <input required type="text" value={formPartyName} onChange={e => setFormPartyName(e.target.value)} placeholder="Full Name" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-slate-500">Phone No</label>
                      <input type="text" value={formContactPhone} onChange={e => setFormContactPhone(e.target.value)} placeholder="Phone Number" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-slate-500">Email</label>
                      <input type="email" value={formContactEmail} onChange={e => setFormContactEmail(e.target.value)} placeholder="Email Address" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-slate-500">ID Proof Type</label>
                      <select value={formContactIdType} onChange={e => setFormContactIdType(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 cursor-pointer">
                        <option value="None">Select ID Proof</option>
                        <option value="Aadhar">Aadhar No</option>
                        <option value="PAN">PAN No</option>
                        <option value="Passport">Passport</option>
                      </select>
                    </div>
                    {formContactIdType !== 'None' && (
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-slate-500">{formContactIdType} Number</label>
                        <input type="text" value={formContactIdNo} onChange={e => setFormContactIdNo(e.target.value)} placeholder={`Enter ${formContactIdType}`} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                      </div>
                    )}
                    <div className="md:col-span-2 space-y-4 pt-2">
                       <label className="block text-xs font-semibold text-slate-500 border-b border-slate-100 dark:border-slate-800 pb-2">Address Details</label>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Address 1</label>
                            <input type="text" value={formContactAddress1} onChange={e => setFormContactAddress1(e.target.value)} placeholder="Building, Street" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                         </div>
                         <div>
                            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Address 2</label>
                            <input type="text" value={formContactAddress2} onChange={e => setFormContactAddress2(e.target.value)} placeholder="Locality, Area" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                         </div>
                         <div>
                            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Country</label>
                            <input type="text" value={formContactCountry} onChange={e => setFormContactCountry(e.target.value)} placeholder="Country" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                         </div>
                         <div>
                            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">State</label>
                            <input type="text" value={formContactState} onChange={e => setFormContactState(e.target.value)} placeholder="State" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                         </div>
                         <div>
                            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">PIN Code</label>
                            <input type="text" value={formContactPin} onChange={e => setFormContactPin(e.target.value)} placeholder="PIN Code" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                         </div>
                         <div>
                            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Fax No</label>
                            <input type="text" value={formContactFax} onChange={e => setFormContactFax(e.target.value)} placeholder="Fax No" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                         </div>
                       </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-slate-500">Category</label>
                      <select value={formContactCategory} onChange={e => {
                         const cat = e.target.value;
                         setFormContactCategory(cat);
                         if (cat !== 'Business' && cat !== 'Registered Business') setFormContactGst('');
                      }} className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 cursor-pointer">
                        {modalType === 'Customer' ? (
                          <>
                            <option value="">Select Category</option>
                            <option value="Consumer">Consumer</option>
                            <option value="Business">Business</option>
                          </>
                        ) : (
                          <>
                            <option value="">Select Category</option>
                            <option value="Unregistered Business">Unregistered Business</option>
                            <option value="Registered Business">Registered Business</option>
                          </>
                        )}
                      </select>
                    </div>
                    {(formContactCategory === 'Business' || formContactCategory === 'Registered Business') && (
                      <div className="animate-in fade-in zoom-in duration-300">
                        <label className="block text-xs font-semibold mb-1 text-slate-500">GST No (Required)</label>
                        <input required type="text" value={formContactGst} onChange={e => setFormContactGst(e.target.value)} placeholder="GST Number" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                      </div>
                    )}
                  </div>
                </div>
              ) : modalType === 'CashEntry' ? (
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
                      <option value="Opening Balance">Daily Opening Balance</option>
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
                  <div className="animate-in fade-in zoom-in duration-300 relative">
                     <label className="block text-xs font-bold mb-1 text-rose-500">{modalType === 'Purchase' ? 'Vendor Name' : 'Customer Name'}</label>
                     <div className="flex gap-2">
                       {showPartySelect ? (
                         <select 
                           required 
                           value={formPartyName} 
                           onChange={e => {
                             const val = e.target.value;
                             setFormPartyName(val);
                             if (val && (modalType === 'Sale' || modalType === 'Advance' || modalType === 'Purchase')) {
                               handleSearchParty(val);
                             }
                           }}
                           className="w-full bg-rose-50 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-700 rounded-lg px-4 py-2 outline-none focus:border-rose-500 cursor-pointer"
                         >
                           <option value="">Select Existing {modalType === 'Purchase' ? 'Vendor' : 'Customer'}</option>
                           {Array.from(new Set(transactions.filter(t => t.type === (modalType === 'Purchase' ? 'Vendor' : 'Customer') && t.partyName).map(t => t.partyName))).map(name => (
                             <option key={name as string} value={name as string}>{name}</option>
                           ))}
                         </select>
                       ) : (
                         <input required type="text" value={formPartyName} onChange={e => setFormPartyName(e.target.value)} placeholder={`e.g. ${modalType === 'Purchase' ? 'Samsung Dist.' : 'John Doe'}`} className="w-full bg-rose-50 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-700 rounded-lg px-4 py-2 outline-none focus:border-rose-500" />
                       )}
                       
                       <div className="flex gap-1">
                         <button 
                           type="button" 
                           onClick={() => setShowPartySelect(!showPartySelect)} 
                           className={`px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer border flex items-center justify-center ${showPartySelect ? 'bg-rose-600 text-white border-rose-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-rose-300 shadow-sm'}`}
                           title={showPartySelect ? "Manual Entry" : "Select from List"}
                         >
                           <i className={showPartySelect ? "ri-keyboard-line" : "ri-arrow-down-s-line"}></i>
                         </button>
                         
                         {(modalType === 'Sale' || modalType === 'Advance' || modalType === 'Purchase') && !showPartySelect && (
                           <button type="button" onClick={() => handleSearchParty()} className="bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 px-3 py-2 rounded-lg text-xs font-bold hover:bg-indigo-200 transition-colors cursor-pointer border border-indigo-200 dark:border-indigo-800 shadow-sm">Search</button>
                         )}
                       </div>
                     </div>
                  </div>
                  {(modalType === 'Sale' || modalType === 'Advance') && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-slate-500">Contact Number</label>
                        <input type="text" value={formContactPhone} onChange={e => setFormContactPhone(e.target.value)} placeholder="Phone Number" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-slate-500">Address</label>
                        <input type="text" value={formContactAddress1} onChange={e => setFormContactAddress1(e.target.value)} placeholder="Address" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                      </div>
                      {(modalType === 'Sale' || (modalType === 'Advance' && isExistingCustomer)) && (
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-slate-500">Aadhar Number</label>
                          <input type="text" value={formContactIdNo} onChange={e => setFormContactIdNo(e.target.value)} placeholder="Aadhar Number" className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              
              {(modalType === 'Sale' || modalType === 'Purchase' || modalType === 'Advance') && (
                <>
                <div>
                    <h4 className="text-sm font-bold text-slate-400 mb-3 uppercase tracking-wider flex justify-between items-center">
                      Product Details
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setIsProductSearchOpen(true); setProductSearchQuery(''); }} className="text-xs bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 font-semibold text-indigo-700 dark:text-indigo-400 flex items-center gap-1 rounded hover:opacity-80 transition cursor-pointer border border-indigo-100 dark:border-indigo-800">
                          <i className="ri-search-line"></i> Find Item
                        </button>
                        <button type="button" onClick={addFormItem} className="text-xs bg-slate-100 dark:bg-slate-800 px-3 py-1.5 font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1 rounded hover:opacity-80 transition cursor-pointer">
                          <span>+</span> Add Another Item
                        </button>
                      </div>
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
                              {modalType === 'Sale' ? (
                                <select required value={item.productName} onChange={e => updateFormItem(idx, 'productName', e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 cursor-pointer">
                                  <option value="">Select Product from Inventory</option>
                                  {Array.from(new Set(parsedData.activeProducts.map(p => p.productName))).map(name => (
                                    <option key={name as string} value={name as string}>{name}</option>
                                  ))}
                                </select>
                              ) : (
                                <input required type="text" value={item.productName} onChange={e => updateFormItem(idx, 'productName', e.target.value)} placeholder="e.g. iPhone 15 Pro" className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500" />
                              )}
                            </div>
                            <div>
                              <label className="block text-xs font-semibold mb-1 text-slate-500">IMEI Number</label>
                              {modalType === 'Sale' ? (
                                <select required value={item.imeiNo} onChange={e => updateFormItem(idx, 'imeiNo', e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 tracking-widest font-mono cursor-pointer">
                                  <option value="">Select IMEI</option>
                                  {parsedData.activeProducts.filter(p => !item.productName || p.productName === item.productName).map(p => (
                                    <option key={p.imeiNo} value={p.imeiNo}>{p.imeiNo}</option>
                                  ))}
                                </select>
                              ) : (
                                <input required type="text" value={item.imeiNo} onChange={e => updateFormItem(idx, 'imeiNo', e.target.value)} placeholder="15-digit IMEI" className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 tracking-widest font-mono" />
                              )}
                            </div>
                            <div>
                              <label className="block text-xs font-semibold mb-1 text-slate-500">Purchase Price (₹)</label>
                              <input required type="number" value={item.purchasePrice} onChange={e => updateFormItem(idx, 'purchasePrice', Number(e.target.value))} placeholder="0.00" className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 font-mono" />
                            </div>
                            {(modalType === 'Sale' || modalType === 'Purchase') && (
                              <div>
                                <label className="block text-xs font-semibold mb-1 text-slate-500">{modalType === 'Sale' ? 'Selling Price (₹)' : 'Target Selling Price (₹)'}</label>
                                <input required={modalType === 'Sale'} type="number" value={item.sellingPrice} onChange={e => updateFormItem(idx, 'sellingPrice', Number(e.target.value))} placeholder="0.00" className="w-full bg-indigo-50/30 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-700 rounded-lg px-4 py-2 outline-none focus:border-indigo-500 font-mono" />
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
                    {modalType === 'Sale' && (
                      <div className="mt-4 flex justify-end">
                        <div className="w-1/2 md:w-1/3">
                          <label className="block text-xs font-bold mb-1 text-rose-500">Discount (₹)</label>
                          <input type="number" value={formDiscount} onChange={e => setFormDiscount(Number(e.target.value) || '')} placeholder="0.00" className="w-full bg-rose-50 dark:bg-rose-900/10 border border-rose-200 dark:border-rose-700 rounded-lg px-4 py-2 outline-none focus:border-rose-500 font-mono text-rose-600 dark:text-rose-400 font-bold" />
                        </div>
                      </div>
                    )}
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
                           <span><i className="ri-check-line"></i> Complete Amount Added</span>
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
                      <label className="block text-xs font-semibold mb-1 text-pink-500"><i className="ri-gift-line"></i> Gift Included (Optional)</label>
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
            ) : checkoutStep === 'Bill' || checkoutStep === 'Invoice' ? (
              <div className="p-6 overflow-y-auto flex-1 flex flex-col items-center justify-center space-y-6">
                 <h2 className="text-2xl font-bold flex items-center gap-2">
                    <i className={checkoutStep === 'Bill' ? 'ri-receipt-line text-emerald-600' : 'ri-file-list-3-line text-indigo-600'}></i> {checkoutStep === 'Bill' ? 'Bill' : 'Tax Invoice'} Preview
                 </h2>
                 <p className="text-slate-500 dark:text-slate-400 text-center max-w-sm">
                   Your {modalType} has been drafted. Would you like to share or print the {checkoutStep === 'Bill' ? 'Bill' : 'Invoice'} before finalizing?
                 </p>
                 
                 {pdfPreviewUrl ? (
                    <div className="w-full max-w-4xl min-h-[75vh] border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-slate-50 dark:bg-slate-900 shadow-inner flex-shrink-0">
                       <iframe src={pdfPreviewUrl} className="w-full h-full min-h-[75vh]" title="PDF Preview" />
                    </div>
                 ) : (
                    <div className="w-full max-w-4xl min-h-[75vh] border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-400 shadow-inner flex-shrink-0">
                       Generating Preview...
                    </div>
                 )}

                 <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl mt-4">
                    <a href={`mailto:?subject=${checkoutStep} for ${pendingTxData?.party_name}&body=Please find the details for your ${checkoutStep}.`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl font-bold transition">
                      <i className="ri-mail-send-line text-lg"></i> Email
                    </a>
                    <a href={`https://wa.me/?text=Hello, your ${checkoutStep} for ${pendingTxData?.party_name} is ready. Total: Rs. ${pendingTxData?.items?.reduce((s:any,i:any)=>s+(modalType==='Sale'?i.sellingPrice:i.purchasePrice),0) - getTxDiscount(pendingTxData)}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-3 bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 rounded-xl font-bold transition">
                      <i className="ri-whatsapp-line text-lg"></i> WhatsApp
                    </a>
                    <button onClick={() => exportInvoice({ ...pendingTxData, id: pendingTxData.id || 'DRAFT', date: pendingTxData.date }, checkoutStep, 'download')} className="flex items-center justify-center gap-2 py-3 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400 rounded-xl font-bold transition cursor-pointer">
                      ⬇️ Download PDF
                    </button>
                    <button onClick={() => exportInvoice({ ...pendingTxData, id: pendingTxData.id || 'DRAFT', date: pendingTxData.date }, 'Combined', 'download')} className="flex items-center justify-center gap-2 py-3 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-xl font-bold transition cursor-pointer border border-emerald-100 dark:border-emerald-800 shadow-sm col-span-2 md:col-span-1">
                      📄 Combined (B+I)
                    </button>
                    <button onClick={() => exportInvoice({ ...pendingTxData, id: pendingTxData.id || 'DRAFT', date: pendingTxData.date }, checkoutStep, 'print')} className="flex items-center justify-center gap-2 py-3 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400 rounded-xl font-bold transition cursor-pointer">

                      🖨️ Print Document
                    </button>
                 </div>

                 <div className="w-full h-px bg-slate-200 dark:bg-slate-800 my-4"></div>

                 {checkoutStep === 'Bill' && modalType === 'Sale' ? (
                   <button onClick={() => setCheckoutStep('Invoice')} className="w-full max-w-sm py-4 bg-slate-900 dark:bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:opacity-90 transition cursor-pointer">
                      Proceed to Tax Invoice ➡️
                   </button>
                 ) : (
                   <button onClick={() => executeSaveTransaction(pendingTxData, checkoutStep === 'Bill' ? 'Bill' : 'Tax Invoice')} className="w-full max-w-sm py-4 bg-emerald-600 text-white rounded-xl font-bold shadow-lg hover:opacity-90 transition cursor-pointer">
                      Finalize & Save {modalType} ✅
                   </button>
                 )}
              </div>
) : null}
          </div>
        </div>
      )}

       {/* Product Search Popup */}
       {isProductSearchOpen && (
         <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
           <div className="bg-white dark:bg-[#1e293b] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col max-h-[80vh]">
             <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-indigo-50/30 dark:bg-indigo-900/10">
               <h3 className="font-bold flex items-center gap-2">
                 <i className="ri-search-line text-indigo-600"></i> Search {modalType === 'Purchase' ? 'Inactive' : 'Active'} Inventory
               </h3>
               <button onClick={() => setIsProductSearchOpen(false)} className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer text-xl">✕</button>
             </div>
             
             <div className="p-4 bg-slate-50 dark:bg-slate-900/50">
               <input 
                 autoFocus
                 type="text" 
                 value={productSearchQuery} 
                 onChange={e => setProductSearchQuery(e.target.value)} 
                 placeholder="Search by Name or IMEI..." 
                 className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 outline-none focus:border-indigo-500 shadow-sm"
               />
             </div>
             
             <div className="flex-1 overflow-y-auto p-2 space-y-1">
               {(() => {
                 const source = modalType === 'Purchase' ? parsedData.inactiveProducts : parsedData.activeProducts;
                 const q = productSearchQuery.toLowerCase();
                 const results = q.length > 0 ? source.filter(p => 
                   p.productName.toLowerCase().includes(q) || 
                   p.imeiNo.toLowerCase().includes(q)
                 ).slice(0, 50) : [];
                 
                 if (q.length === 0) return <div className="text-center py-10 text-slate-400 text-sm italic">Type to search for items...</div>;
                 if (results.length === 0) return <div className="text-center py-10 text-slate-400 text-sm italic">No matching products found.</div>;
                 
                 return results.map((p, idx) => (
                   <button 
                     key={idx} 
                     onClick={() => {
                        const emptyIdx = formItems.findIndex(it => !it.productName && !it.imeiNo);
                        if (emptyIdx !== -1) {
                           updateFormItem(emptyIdx, 'productName', p.productName);
                           updateFormItem(emptyIdx, 'imeiNo', p.imeiNo);
                        } else {
                           setFormItems(prev => [...prev, {
                             productName: p.productName,
                             imeiNo: p.imeiNo,
                             purchasePrice: p.purchasePrice,
                             sellingPrice: p.sellingPrice || ''
                           }]);
                        }
                        setIsProductSearchOpen(false);
                     }}
                     className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-left transition-colors border border-transparent hover:border-indigo-100 dark:hover:border-indigo-800 group"
                   >
                     <div>
                       <div className="font-bold text-slate-700 dark:text-slate-200">{p.productName}</div>
                       <div className="text-xs text-slate-500 font-mono mt-0.5">IMEI: {p.imeiNo}</div>
                     </div>
                     <div className="text-right">
                       <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400">Select Item <i className="ri-arrow-right-s-line"></i></div>
                       <div className="text-[10px] text-slate-400 mt-0.5">₹{p.purchasePrice.toLocaleString()}</div>
                     </div>
                   </button>
                 ));
               })()}
             </div>
             
             <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 text-[11px] text-slate-400 text-center">
               Search results are limited to top 50 matches for performance.
             </div>
           </div>
         </div>
       )}

      {showMobileMenu && (
        <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setShowMobileMenu(false)} />
      )}
      {/* Sidebar */}
      <aside className={`w-64 border-r flex flex-col fixed inset-y-0 left-0 z-40 transform transition-transform duration-300 lg:relative lg:translate-x-0 ${theme === 'dark' ? 'bg-[#1e293b] border-slate-800' : 'bg-white border-slate-200'} ${showMobileMenu ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:flex'}`}>
        <div className="p-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-col items-start gap-2">
            <img 
              src="/logo.png" 
              alt="Amvidis India Logo" 
              className={`w-40 h-auto object-contain transition-all duration-300 ${theme === 'dark' ? 'invert' : ''}`}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                (e.target as HTMLImageElement).nextElementSibling!.classList.remove('hidden');
              }} 
            />
            <div className="hidden w-12 h-10 bg-gradient-to-tr from-indigo-600 to-violet-500 rounded-xl flex flex-shrink-0 items-center justify-center text-white font-bold text-sm shadow-lg">
              AI
            </div>
            <span className="font-extrabold text-lg text-slate-700 dark:text-slate-300 tracking-tight leading-tight mt-1">Powered by Amvidis India</span>
          </div>
        </div>
        
        <div className="p-4 flex flex-col gap-3">
           <div className="grid grid-cols-2 gap-2">
             <button onClick={() => openModal('Sale')} className="flex items-center justify-center gap-1.5 text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg transition-all cursor-pointer shadow-md active:scale-95">
               <i className="ri-add-circle-line text-sm"></i> SALE
             </button>
             <button onClick={() => openModal('Purchase')} className="flex items-center justify-center gap-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-lg transition-all cursor-pointer shadow-md active:scale-95">
               <i className="ri-download-cloud-2-line text-sm"></i> PURCHASE
             </button>
           </div>
           <div className="grid grid-cols-2 gap-2">
             <button onClick={() => openModal('Advance')} className="flex items-center justify-center gap-1.5 text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-lg transition-all cursor-pointer shadow-md active:scale-95">
               <i className="ri-hand-coin-line text-sm"></i> ADVANCE
             </button>
             <button onClick={() => openModal('CashEntry')} className="flex items-center justify-center gap-1.5 text-[11px] font-bold bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-lg transition-all cursor-pointer shadow-md active:scale-95">
               <i className="ri-exchange-funds-line text-sm"></i> CASH ENTRY
             </button>
           </div>
           <div className="grid grid-cols-2 gap-2 mt-1">
             <button onClick={() => openModal('Customer')} className="flex items-center justify-center gap-1.5 text-[11px] font-bold bg-indigo-500 hover:bg-indigo-600 text-white py-2.5 rounded-lg transition-all cursor-pointer shadow-md active:scale-95">
               <i className="ri-user-add-line text-sm"></i> CUSTOMERS
             </button>
             <button onClick={() => openModal('Vendor')} className="flex items-center justify-center gap-1.5 text-[11px] font-bold bg-slate-700 hover:bg-slate-800 text-white py-2.5 rounded-lg transition-all cursor-pointer shadow-md active:scale-95">
               <i className="ri-store-2-line text-sm"></i> VENDORS
             </button>
           </div>
        </div>

        <nav className="flex-1 px-4 space-y-1.5 mt-4 mb-4 overflow-y-auto custom-scrollbar">
          {[
            { id: 'Dashboard', icon: 'ri-dashboard-line' },
            { id: 'Sales', icon: 'ri-shopping-cart-2-line' },
            { id: 'Purchases', icon: 'ri-shopping-bag-line' },
            { id: 'Advances', icon: 'ri-hand-coin-line' },
            { id: 'Cash Tracker', icon: 'ri-wallet-3-line' },
            { id: 'Inventory', icon: 'ri-database-2-line' },
            { id: 'Customers', icon: 'ri-user-heart-line' },
            { id: 'Vendors', icon: 'ri-store-2-line' },
            { id: 'Billing & Invoices', icon: 'ri-file-list-3-line' },
            { id: 'All Details', icon: 'ri-bar-chart-box-line' }
          ].map((item) => {

            return (
              <button
                key={item.id}
                onClick={() => { setActiveTab(item.id); setShowMobileMenu(false); }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 cursor-pointer group ${
                  activeTab === item.id 
                    ? 'bg-indigo-600 text-white font-bold shadow-md shadow-indigo-200 dark:shadow-none' 
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium'
                }`}
              >
                <i className={`${item.icon} text-lg ${activeTab === item.id ? 'text-white' : 'text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400'}`}></i>
                <span className="text-sm">{item.id}</span>
              </button>
            );
          })}
          <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-900/10 text-rose-600 dark:text-rose-400 transition-all cursor-pointer font-bold group"
            >
              <i className="ri-logout-box-r-line text-lg group-hover:scale-110 transition-transform"></i>
              <span className="text-sm">Sign Out</span>
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
            <div className="flex items-center gap-2">
              <button 
                onClick={() => { console.log('Theme toggle clicked'); toggleTheme(); }} 
                className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer relative z-50" 
                title="Toggle Theme"
              >
                <i className={theme === 'dark' ? 'ri-sun-line text-amber-400' : 'ri-moon-line text-indigo-600'}></i>
              </button>
              <button onClick={() => setShowMobileMenu(true)} className="lg:hidden p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-xl">
                <i className="ri-menu-line"></i>
              </button>
            </div>
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
               <span className="absolute left-3 top-2.5 text-slate-400 text-lg"><i className="ri-search-line"></i></span>
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
                <i className="ri-file-list-3-line text-lg"></i> Report
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
                      <i className={stat.icon}></i>
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
             <h2 className="text-2xl font-bold mb-6 border-b border-slate-100 dark:border-slate-800 pb-4 flex items-center gap-2"><i className="ri-bar-chart-box-line text-indigo-500"></i> Comprehensive Financial Summary</h2>
             
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
                      <span className="font-medium text-sm text-slate-600 dark:text-slate-300">Net Loss</span>
                      <span className="text-rose-500 font-bold text-xl font-mono">₹{stats.details.totalLoss.toLocaleString()}</span>
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

        {(activeTab === 'Dashboard' || activeTab === 'Sales' || activeTab === 'Purchases' || activeTab === 'Advances' || activeTab === 'Billing & Invoices' || activeTab === 'Bills' || activeTab === 'Tax Invoices') && (
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
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(activeTab === 'Customers' || activeTab === 'Vendors') && (
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-300">
             {displayList.length === 0 ? (
                <div className="col-span-full py-12 text-center text-slate-500 border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-[#1e293b] shadow-sm">
                   No {activeTab.toLowerCase()} found.
                </div>
             ) : (
                displayList.map(tx => {
                   const item = getTxItems(tx)[0] || {} as any;
                   return (
                     <div key={tx.id} className="bg-white dark:bg-[#1e293b] rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm relative group hover:shadow-md transition-all">
                        <div className="absolute top-4 right-4 z-10 group/menu" tabIndex={0}>
                           <button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none">
                              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                           </button>
                           <div className="hidden group-focus-within/menu:flex flex-col absolute right-0 top-full mt-1 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700 shadow-xl rounded-xl py-1 w-44 overflow-hidden transform transition-all origin-top-right">
                              <button onClick={() => setViewingParty(tx)} className="w-full text-left px-4 py-2.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors flex items-center gap-2"><span>👀</span> View History</button>
                              <button onClick={() => {
                                 resetForm();
                                 setModalType(tx.type === 'Customer' ? 'Vendor' : 'Customer');
                                 setFormPartyName(tx.partyName || '');
                                 setFormContactPhone(item.phone || '');
                                 setFormContactEmail(item.email || '');
                                 setFormContactAddress1(item.address1 || '');
                                 setFormContactAddress2(item.address2 || '');
                                 setFormContactCountry(item.country || 'India');
                                 setFormContactState(item.state || '');
                                 setFormContactPin(item.pin || '');
                                 setFormContactFax(item.fax || '');
                                 setFormContactIdType(item.idProofType || 'None');
                                 setFormContactIdNo(item.idProofNo || '');
                                 setFormContactGst(item.gstNo || '');
                                 setIsModalOpen(true);
                              }} className="w-full text-left px-4 py-2.5 text-xs font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors flex items-center gap-2"><span>📋</span> Copy to {tx.type === 'Customer' ? 'Vendor' : 'Customer'}</button>
                              <button onClick={() => openEditModal(tx)} className="w-full text-left px-4 py-2.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors flex items-center gap-2"><span>✏️</span> <i className="ri-edit-line text-sm"></i> Edit Details</button>
                              <div className="h-px bg-slate-100 dark:border-slate-800 my-1 w-full"></div>
                               <button onClick={() => deleteTx(tx.id)} className="flex items-center gap-1 text-[11px] text-rose-600 hover:text-white hover:bg-rose-600 cursor-pointer font-bold border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded-lg transition-all shadow-sm">
                                 <i className="ri-delete-bin-line text-sm"></i> Delete
                               </button>
                           </div>
                        </div>
                        <h3 className="font-bold text-lg mb-1 pr-10 text-slate-800 dark:text-slate-100">{tx.partyName}</h3>
                        <div className="mt-4 space-y-2 text-[13px] text-slate-600 dark:text-slate-400">
                           {item.phone && <p className="flex items-center gap-2"><i className="ri-phone-line text-slate-400"></i> {item.phone}</p>}
                           {item.email && <p className="flex items-center gap-2"><i className="ri-mail-line text-slate-400"></i> {item.email}</p>}
                           {[item.address1, item.address2, item.pin, item.state, item.country].filter(Boolean).join(', ') && <p className="flex items-start gap-2"><i className="ri-map-pin-line text-slate-400 mt-0.5"></i> <span className="line-clamp-2 leading-relaxed">{[item.address1, item.address2, item.pin, item.state, item.country].filter(Boolean).join(', ')}</span></p>}
                           {item.fax && <p className="flex items-center gap-2"><i className="ri-printer-line text-slate-400"></i> {item.fax}</p>}
                        </div>
                        <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
                           <span className="text-[10px] bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded font-bold uppercase text-slate-600 dark:text-slate-400">{item.category || (tx.type === 'Customer' ? 'Consumer' : 'Unregistered Business')}</span>
                           {item.gstNo && <span className="text-[10px] bg-amber-50 border border-amber-200 text-amber-700 px-2 py-1 rounded font-bold uppercase">GST: {item.gstNo}</span>}
                           {item.idProofType && item.idProofType !== 'None' && <span className="text-[10px] bg-indigo-50 border border-indigo-200 text-indigo-700 px-2 py-1 rounded font-bold uppercase">{item.idProofType}: {item.idProofNo}</span>}
                        </div>
                     </div>
                   )
                })
             )}
           </div>
        )}

        {activeTab === 'Cash Tracker' && (
          <div className="flex flex-col gap-6 animate-in fade-in duration-300 flex-1">
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-2xl w-12 h-12 flex items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600">
                      <i className="ri-arrow-down-circle-line"></i>
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Total Cash IN</p>
                  <p className="text-3xl font-bold tracking-tight text-emerald-600">₹{parsedData.details.filteredCashIn.toLocaleString()}</p>
                </div>
                <div className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-2xl w-12 h-12 flex items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-500">
                      <i className="ri-arrow-up-circle-line"></i>
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Total Cash OUT</p>
                  <p className="text-3xl font-bold tracking-tight text-rose-500">₹{parsedData.details.filteredCashOut.toLocaleString()}</p>
                </div>
                <div className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-2xl w-12 h-12 flex items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600">
                      <i className="ri-wallet-3-line"></i>
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
                               {c.remark && <span className="text-[10px] text-slate-400 mt-1 whitespace-normal break-words max-w-[200px]">"{c.remark}"</span>}
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
                               <button onClick={() => deleteTx(c.id)} className="text-xs text-rose-500 hover:underline bg-rose-50 px-2 py-0.5 rounded border border-rose-100 font-semibold"><i className="ri-delete-bin-line text-sm"></i> Delete</button>
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
                      <i className="ri-box-3-line"></i>
                    </span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-1">Total Active Products</p>
                  <p className="text-3xl font-bold tracking-tight text-emerald-600">{displayData.activeItems.length}</p>
                </div>

                <div className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-2xl w-12 h-12 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500">
                      <i className="ri-price-tag-3-line"></i>
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
                       🗑️ <i className="ri-delete-bin-line text-sm"></i> Delete ({selectedInventory.length})
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
                                 ✏️ <i className="ri-edit-line text-sm"></i> Edit
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
                                 🗑️ <i className="ri-delete-bin-line text-sm"></i> Delete
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
      {viewingParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-[#1e293b] rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700 my-8 max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center shrink-0 bg-slate-50 dark:bg-slate-900/50">
              <h3 className="font-bold text-lg flex items-center gap-2">
                👤 {viewingParty.partyName} ({viewingParty.type}) - Transaction History
              </h3>
              <button onClick={() => setViewingParty(null)} className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer text-xl">✕</button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
               <table className="w-full text-left whitespace-nowrap">
                 <thead>
                   <tr className="bg-slate-100/50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider font-semibold">
                     <th className="px-6 py-4">Date</th>
                     <th className="px-6 py-4">Type</th>
                     <th className="px-6 py-4">Items</th>
                     <th className="px-6 py-4">Total Value</th>
                     <th className="px-6 py-4 text-right">Action</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                   {transactions.filter(t => t.partyName === viewingParty.partyName && t.type !== 'Customer' && t.type !== 'Vendor').length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-6 text-slate-500">No transactions found.</td></tr>
                   ) : transactions.filter(t => t.partyName === viewingParty.partyName && t.type !== 'Customer' && t.type !== 'Vendor').map(tx => (
                     <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                       <td className="px-6 py-4 text-sm">{tx.date}</td>
                       <td className="px-6 py-4"><span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">{tx.type}</span></td>
                       <td className="px-6 py-4 text-sm">{getTxItems(tx).length} items</td>
                       <td className="px-6 py-4 text-sm font-mono text-slate-800 dark:text-slate-200">₹{getTxTotalSelling(tx) || getTxTotalPurchase(tx) || tx.paymentRecords[0]?.amount || 0}</td>
                       <td className="px-6 py-4 text-right">
                          <button onClick={() => { setViewingParty(null); openEditModal(tx); }} className="text-xs text-indigo-500 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded transition-colors opacity-0 group-hover:opacity-100"><i className="ri-edit-line text-sm"></i> Edit Tx</button>
                       </td>
                     </tr>
                   ))}
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
