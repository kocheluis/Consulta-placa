import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { isAdminEmail, hasAdmins } from '@/lib/admin';
import { listPendingPurchases } from '@/lib/payments';
import { Icon } from '@/components/ui/Icon';
import { AdminPagosClient } from './AdminPagosClient';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Pagos pendientes · Admin · PlacaPe',
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[960px] px-4 py-10 sm:px-6">{children}</div>;
}

function Notice({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="mx-auto max-w-[520px] rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-azul-50">
        <Icon name={icon} className="text-[28px] text-primary" />
      </div>
      <h1 className="font-heading text-xl font-extrabold text-foreground">{title}</h1>
      <p className="mx-auto mt-2 max-w-sm font-body text-sm leading-relaxed text-muted">{text}</p>
      <Link href="/" className="mt-5 inline-flex items-center gap-1.5 font-body text-sm font-semibold text-primary hover:underline">
        <Icon name="arrow_back" className="text-[18px]" /> Volver al inicio
      </Link>
    </div>
  );
}

export default async function AdminPagosPage() {
  if (!isSupabaseConfigured) {
    return (
      <Shell>
        <Notice
          icon="info"
          title="Supabase no configurado"
          text="El panel de pagos requiere Supabase (Auth + base de datos) configurado en el entorno."
        />
      </Shell>
    );
  }

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) redirect('/cuenta?next=/admin/pagos');

  if (!isAdminEmail(user.email)) {
    return (
      <Shell>
        <Notice
          icon="lock"
          title="Acceso restringido"
          text={
            hasAdmins
              ? 'Tu cuenta no tiene permisos de administrador.'
              : 'Aún no hay administradores configurados. Define ADMIN_EMAILS en el entorno con tu correo.'
          }
        />
      </Shell>
    );
  }

  const pending = await listPendingPurchases();

  return (
    <Shell>
      <AdminPagosClient initial={pending} />
    </Shell>
  );
}
