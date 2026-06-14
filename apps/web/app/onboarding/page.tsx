'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { isValidPlate, normalizePlate } from '@app/shared';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PlateInput } from '@/components/ui/PlateInput';

/* ── Shell con logo + indicador de pasos ──────────────────────────── */
function Shell({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <section
      className="grid place-items-center px-4 py-12 sm:py-16"
      style={{ background: 'radial-gradient(120% 130% at 80% -10%, #EFF6F9 0%, #EEF2F5 60%)' }}
    >
      <div className="w-full max-w-[480px]">
        <div className="mb-5 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-placape.svg" alt="PlacaPe" className="inline-block h-8" />
        </div>
        <div className="mb-5 flex justify-center gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${i === step ? 'w-7' : 'w-2'} ${
                i <= step ? 'bg-accent' : 'bg-slate-300'
              }`}
            />
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-surface p-8 shadow-lg">{children}</div>
      </div>
    </section>
  );
}

/* ── Paso 1 · Verificación OTP (preview, se cablea con Supabase) ───── */
function OtpView({ go }: { go: (n: number) => void }) {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const set = (i: number, v: string) => {
    if (!/^\d?$/.test(v)) return;
    const next = code.slice();
    next[i] = v;
    setCode(next);
    if (v && i < 5) refs.current[i + 1]?.focus();
  };
  const onKey = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) refs.current[i - 1]?.focus();
  };
  const full = code.every((c) => c !== '');

  return (
    <>
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg bg-azul-50">
        <Icon name="sms" className="text-[30px] text-primary" />
      </div>
      <h1 className="text-center font-heading text-2xl font-extrabold tracking-tight text-foreground">
        Verifica tu celular
      </h1>
      <p className="mx-auto mb-6 mt-2 text-center text-[15px] leading-relaxed text-muted">
        Te enviaremos un código de 6 dígitos por SMS para proteger tu cuenta.
      </p>
      <div className="mb-4 flex justify-center gap-2.5">
        {code.map((c, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={c}
            inputMode="numeric"
            maxLength={1}
            aria-label={`Dígito ${i + 1}`}
            onChange={(e) => set(i, e.target.value)}
            onKeyDown={(e) => onKey(i, e)}
            className={`h-[58px] w-12 rounded-md border-[1.5px] bg-surface text-center font-mono text-2xl font-bold text-foreground outline-none transition-colors ${
              c ? 'border-accent' : 'border-border'
            }`}
          />
        ))}
      </div>
      <Button variant="accent" size="lg" block iconRight="arrow_forward" disabled={!full} onClick={() => go(1)}>
        Verificar
      </Button>
      <p className="mt-4 text-center text-sm text-muted">
        ¿No te llegó? <span className="font-bold text-slate-400">Reenviar en 0:24</span>
      </p>
      <p className="mt-4 rounded-md border border-azul-200 bg-azul-50 px-3 py-2 text-center text-[12.5px] leading-snug text-azul-700">
        La verificación por SMS se activa con Supabase. En esta vista previa puedes ingresar cualquier código.
      </p>
    </>
  );
}

/* ── Paso 2 · Intención ───────────────────────────────────────────── */
function IntentView({ go }: { go: (n: number) => void }) {
  const [sel, setSel] = useState('comprar');
  const opts = [
    { id: 'comprar', icon: 'shopping_cart', title: 'Voy a comprar un auto', desc: 'Verificar antes de pagar' },
    { id: 'vender', icon: 'sell', title: 'Voy a vender mi auto', desc: 'Mostrar un reporte de confianza' },
    { id: 'empresa', icon: 'storefront', title: 'Soy empresa / concesionaria', desc: 'Verificar varios vehículos' },
  ];
  return (
    <>
      <h1 className="text-center font-heading text-2xl font-extrabold tracking-tight text-foreground">
        ¿Qué te trae a PlacaPe?
      </h1>
      <p className="mb-6 mt-2 text-center text-[15px] text-muted">Personalizamos tu experiencia.</p>
      <div className="mb-6 flex flex-col gap-2.5">
        {opts.map((o) => {
          const on = o.id === sel;
          return (
            <button
              key={o.id}
              onClick={() => setSel(o.id)}
              className={`flex cursor-pointer items-center gap-3.5 rounded-md border-[1.5px] px-4 py-3.5 text-left transition-colors ${
                on ? 'border-accent bg-teal-50' : 'border-border bg-surface hover:border-azul-200'
              }`}
            >
              <div
                className={`grid h-[42px] w-[42px] flex-none place-items-center rounded-md ${
                  on ? 'bg-white' : 'bg-background'
                }`}
              >
                <Icon name={o.icon} className={`text-[24px] ${on ? 'text-teal-700' : 'text-muted'}`} />
              </div>
              <div className="flex-1">
                <p className="font-body text-[15px] font-bold text-foreground">{o.title}</p>
                <p className="mt-0.5 text-[13px] text-muted">{o.desc}</p>
              </div>
              <Icon
                name={on ? 'radio_button_checked' : 'radio_button_unchecked'}
                fill={on}
                className={`text-[22px] ${on ? 'text-accent' : 'text-slate-300'}`}
              />
            </button>
          );
        })}
      </div>
      <Button variant="accent" size="lg" block iconRight="arrow_forward" onClick={() => go(2)}>
        Continuar
      </Button>
    </>
  );
}

/* ── Paso 3 · Primera búsqueda ────────────────────────────────────── */
function FirstSearchView() {
  const router = useRouter();
  const [placa, setPlaca] = useState('');
  const [error, setError] = useState<string | null>(null);

  const go = () => {
    const normalized = normalizePlate(placa);
    if (!isValidPlate(normalized)) {
      setError('Ingresa una placa peruana válida (ej. ABC-123).');
      return;
    }
    router.push(`/guiada/${normalized}`);
  };

  return (
    <>
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-lg bg-success-bg">
        <Icon name="check_circle" fill className="text-[32px] text-success" />
      </div>
      <h1 className="text-center font-heading text-2xl font-extrabold tracking-tight text-foreground">
        ¡Cuenta lista!
      </h1>
      <p className="mx-auto mb-6 mt-2 text-center text-[15px] leading-relaxed text-muted">
        Tu primer <strong className="text-success">reporte básico es gratis</strong>. Ingresa una placa para empezar.
      </p>
      <div className="mb-4 flex justify-center">
        <PlateInput value={placa} onChange={setPlaca} onEnter={go} size="lg" />
      </div>
      {error && (
        <p className="mb-3 text-center text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <Button variant="accent" size="lg" block iconRight="arrow_forward" onClick={go}>
        Verificar placa
      </Button>
      <p className="mt-4 text-center">
        <Link href="/cuenta" className="font-body text-sm font-semibold text-muted hover:text-foreground">
          Ir a mi cuenta
        </Link>
      </p>
    </>
  );
}

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  return (
    <Shell step={step}>
      {step === 0 && <OtpView go={setStep} />}
      {step === 1 && <IntentView go={setStep} />}
      {step === 2 && <FirstSearchView />}
    </Shell>
  );
}
