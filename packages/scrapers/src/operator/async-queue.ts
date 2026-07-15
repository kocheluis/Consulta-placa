/**
 * Canal asíncrono simple (single-process, mono-hilo): `push` encola un item y `take` devuelve el
 * siguiente — resolviendo apenas hay uno, o al instante si ya había. Es el primitivo del MOTOR
 * CONTINUO: el dispatcher hace `push(placa)` conforme llegan pedidos y los workers de vida larga
 * (pool de historial, carril ligero) hacen `for(;;){ const it = await take(); if(!it) break; … }`.
 *
 * A diferencia del array fijo del motor por lotes, este canal admite items NUEVOS mientras los
 * workers ya están consumiendo → un pedido que entra tarde NO espera a que termine un lote.
 *
 * - Varios workers pueden `take()` a la vez: cada item va a UN solo consumidor (FIFO de esperas).
 * - `close()` despierta a todos los que esperan con `null` (señal de fin) y hace que los `take`
 *   futuros devuelvan `null` de inmediato → los bucles de worker terminan limpio.
 * - `push` tras `close()` es no-op (no se aceptan más items).
 */
export class AsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(v: T | null) => void> = [];
  private closed = false;

  /** Encola un item. Si hay un `take` esperando, se lo entrega directo. No-op si el canal se cerró. */
  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  /** Devuelve el siguiente item; espera si no hay. Devuelve `null` si el canal está cerrado y vacío. */
  take(): Promise<T | null> {
    if (this.items.length) return Promise.resolve(this.items.shift()!);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => { this.waiters.push(resolve); });
  }

  /** Cierra el canal: los `take` en espera y los futuros resuelven `null`. Los items ya encolados
   *  se drenan igual (take los devuelve antes que null). */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiters.splice(0)) w(null);
  }

  /** Items encolados aún sin consumir (para métricas/backpressure). */
  get size(): number { return this.items.length; }
  /** ¿Hay consumidores esperando un item? */
  get waiting(): number { return this.waiters.length; }
  get isClosed(): boolean { return this.closed; }
}
