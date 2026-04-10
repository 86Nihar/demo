import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xddliaywdzbsoizjxiga.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkZGxpYXl3ZHpic29pemp4aWdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MzY2NjcsImV4cCI6MjA5MTQxMjY2N30.HXycg1xfggYA29ONJCtVpb0iFyEnWtt0mfKXMkNOjjs';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
