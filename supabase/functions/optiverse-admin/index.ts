// Supabase Edge Function: Privileged Admin & Backup Operations
// Deploy with: supabase functions deploy optiverse-admin

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: roleRow } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!roleRow || roleRow.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden: Admin role required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    if (body.action === 'export_backup') {
      const [shops, products, inquiries, plans, payments, auditLogs] = await Promise.all([
        adminClient.from('shops').select('*'),
        adminClient.from('products').select('*, product_images(*)'),
        adminClient.from('inquiries').select('*'),
        adminClient.from('plans').select('*'),
        adminClient.from('payments').select('*'),
        adminClient.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200),
      ]);

      return new Response(
        JSON.stringify({
          exported_at: new Date().toISOString(),
          shops: shops.data ?? [],
          products: products.data ?? [],
          inquiries: inquiries.data ?? [],
          plans: plans.data ?? [],
          payments: payments.data ?? [],
          audit_logs: auditLogs.data ?? [],
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
