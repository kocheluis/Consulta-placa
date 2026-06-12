'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const TIPOS = [
  { value: 'ACCESS', label: 'Acceso a mis datos' },
  { value: 'DELETION', label: 'Eliminación / cancelación' },
  { value: 'RECTIFICATION', label: 'Rectificación' },
  { value: 'OPPOSITION', label: 'Oposición' },
];

export default function SolicitarDatosPage() {
  const [type, setType] = useState('DELETION');
  const [contactEmail, setEmail] = useState('');
  const [plateOrSubject, setPlate] = useState('');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/solicitudes-datos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, contactEmail, plateOrSubject: plateOrSubject || null, details: details || null }),
      });
      if (!res.ok) throw new Error('No se pudo registrar la solicitud.');
      setStatus('ok');
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  };

  if (status === 'ok') {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <div className="rounded-xl border border-success bg-success-bg p-6 text-success-fg">
          <h1 className="font-heading font-semibold text-lg">Solicitud registrada</h1>
          <p className="mt-1 text-sm">
            Hemos recibido tu solicitud. Te contactaremos al correo indicado para darle seguimiento.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-foreground">Solicitud sobre datos personales</h1>
      <p className="mt-2 text-sm text-muted">
        Ejerce tus derechos sobre tus datos personales (Ley 29733 / DS 016-2024-JUS).
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="type" className="block text-sm font-medium text-foreground mb-1">
            Tipo de solicitud
          </label>
          <select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
            Correo de contacto
          </label>
          <input
            id="email"
            type="email"
            required
            value={contactEmail}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          />
        </div>

        <div>
          <label htmlFor="plate" className="block text-sm font-medium text-foreground mb-1">
            Placa o referencia (opcional)
          </label>
          <input
            id="plate"
            value={plateOrSubject}
            onChange={(e) => setPlate(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          />
        </div>

        <div>
          <label htmlFor="details" className="block text-sm font-medium text-foreground mb-1">
            Detalles (opcional)
          </label>
          <textarea
            id="details"
            rows={4}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          />
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={status === 'sending'}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors duration-200 hover:bg-primary-600 cursor-pointer disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          {status === 'sending' ? 'Enviando…' : 'Enviar solicitud'}
        </button>
      </form>
    </div>
  );
}
