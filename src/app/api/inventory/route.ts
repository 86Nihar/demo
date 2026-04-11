import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Inventory API Structure
// requirement: 1. INVENTORY & PRODUCT TRACKING
// Maintain all product details using IMEI number as unique identifier
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { imei, product_name, purchase_price, selling_price } = body;

    if (!imei || !product_name || !purchase_price) {
      return NextResponse.json({ error: 'Missing required fields (imei, product_name, purchase_price)' }, { status: 400 });
    }

    // Insert Product (Status is ACTIVE by default as per schema)
    const { data, error } = await supabase
      .from('products')
      .insert({
        imei,
        product_name,
        purchase_price,
        selling_price: selling_price || 0,
        status: 'ACTIVE'
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // unique violation
        return NextResponse.json({ error: 'Product with this IMEI already exists' }, { status: 409 });
      }
      throw error;
    }

    // Since a new product involves "Cash OUT" (purchasing the inventory) or just adding to stock
    // If it's a purchase entry, we should ideally log it in `product_transactions` & `cash_transactions`
    
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  let query = supabase.from('products').select('*');
  
  if (status) {
    // Allows filtering by ACTIVE or INACTIVE
    query = query.eq('status', status.toUpperCase());
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Calculate total active inventory dynamically if no status was provided
  const activeProducts = data.filter(p => p.status === 'ACTIVE');
  const inactiveProducts = data.filter(p => p.status === 'INACTIVE');

  return NextResponse.json({
    totalProducts: data.length,
    activeCount: activeProducts.length,
    inactiveCount: inactiveProducts.length,
    data
  });
}
