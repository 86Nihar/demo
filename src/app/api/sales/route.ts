import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// SALES TRANSACTIONS API Structure
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      imei, 
      customer_name, 
      selling_price, 
      payment_method, 
      gift_name,
      message, 
      amount_paid 
    } = body;

    if (!imei || !selling_price || !amount_paid || !payment_method) {
      return NextResponse.json({ error: 'Missing required Sales fields' }, { status: 400 });
    }

    // 1. Fetch the Product to make sure it exists & is ACTIVE
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('imei', imei)
      .single();

    if (productError || !product) {
       return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    if (product.status === 'INACTIVE') {
       return NextResponse.json({ error: 'Product is INACTIVE (Already sold)' }, { status: 400 });
    }

    // 2. Calculate Profit (Selling Price – Purchase Price)
    const profit = Number(selling_price) - Number(product.purchase_price);

    // 3. Mark Product as INACTIVE
    await supabase.from('products').update({ status: 'INACTIVE', updated_at: new Date().toISOString() }).eq('imei', imei);

    // 4. Create the Sale Transaction
    const { data: transaction, error: txError } = await supabase
      .from('product_transactions')
      .insert({
        imei,
        transaction_type: 'OUT',
        customer_name,
        price: selling_price,
        profit,
        gift_name,
        message
      })
      .select()
      .single();

    if (txError) throw txError;

    // 5. Update Cash Counter
    await supabase
      .from('cash_transactions')
      .insert({
        type: 'IN',
        category: 'SALES',
        amount: amount_paid,
        description: `Sale received from ${customer_name}`,
        related_ref: transaction.id
      });

    // 6. If Gift used, record it in gift_transactions (Gift OUT)
    if (gift_name) {
       // Search for the gift in the gifts table to update `total_out`
       // This implies an additional query or a direct insert to gift_transactions
       // (Depending on exact implementation of ID mappings in frontend)
    }

    return NextResponse.json({ success: true, transaction, profit }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
