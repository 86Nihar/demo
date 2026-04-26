-- Paste this code into the SQL Editor in your Supabase dashboard and click "Run"

-- Create the main transactions table 
CREATE TABLE public.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    party_name TEXT,
    date TEXT NOT NULL,
    items JSONB DEFAULT '[]'::jsonb,
    payment_records JSONB DEFAULT '[]'::jsonb,
    payment_status TEXT,
    remark TEXT,
    gift TEXT,
    is_excluded BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Turn on Row Level Security (RLS) for the table
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Create policies so users can only view and manage their own data
CREATE POLICY "Users can insert their own transactions" 
ON public.transactions FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own transactions" 
ON public.transactions FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions" 
ON public.transactions FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions" 
ON public.transactions FOR DELETE 
USING (auth.uid() = user_id);
