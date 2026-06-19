'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAccount, type Account } from '@/lib/account';
import { Icon } from '@/components/ui/Icon';

/**
 * Estado de sesión en la barra superior: muestra "Iniciar sesión" si no hay
 * sesión, o un chip con el nombre/correo (enlaza a /cuenta) si la hay.
 * Client component: lee la sesión de Supabase en el navegador.
 */
export function HeaderAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getAccount()
      .then((a) => alive && setAccount(a))
      .catch(() => alive && setAccount(null))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!loaded) return null;

  if (!account) {
    return (
      <Link
        href="/cuenta"
        className="hidden font-body text-[14.5px] font-semibold text-foreground hover:text-primary sm:inline"
      >
        Iniciar sesión
      </Link>
    );
  }

  const label = account.fullName?.trim().split(/\s+/)[0] || account.email.split('@')[0];
  return (
    <Link
      href="/cuenta"
      aria-label="Mi cuenta"
      className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 font-body text-[14px] font-semibold text-foreground transition-colors hover:bg-azul-50"
    >
      <span className="grid h-7 w-7 place-items-center rounded-full bg-azul-50 text-primary">
        <Icon name="person" className="text-[18px]" />
      </span>
      <span className="hidden max-w-[120px] truncate sm:inline">{label}</span>
    </Link>
  );
}
