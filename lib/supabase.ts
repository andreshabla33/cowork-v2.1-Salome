
import { createClient } from '@supabase/supabase-js';

export const APP_URL = 'https://mvp-cowork.vercel.app';
export const SUPABASE_URL = 'https://lcryrsdyrzotjqdxcwtp.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxjcnlyc2R5cnpvdGpxZHhjd3RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc2NDg0MTgsImV4cCI6MjA4MzIyNDQxOH0.8fsqkKHHOVCZMi8tAb85HN_It2QCSWP0delcFn56vd4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
