import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vhzkmhlnaiwhczxjskmr.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoemttaGxuYWl3aGN6eGpza21yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTIzNTMsImV4cCI6MjA5MjYyODM1M30.sRle0uPNDUD_AsumKn9kCfYKNiwbUgMyx5fn9Xf0ROg';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
