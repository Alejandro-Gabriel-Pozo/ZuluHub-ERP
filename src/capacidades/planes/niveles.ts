/**
 * La única pieza común de las escaleras de niveles (reglas transversales §7.7, marcas y planes
 * §B.5.8). Un nivel son dos datos: la HABILITACIÓN (qué niveles extra permite el plan: un interruptor
 * por nivel) y la ELECCIÓN (qué nivel usa la empresa, que cambia el gerente). Esto decide con qué
 * nivel NACE un registro nuevo; lo existente conserva el que lleva copiado.
 *
 * Solo se usa al crear un registro, dentro de su transacción y después de leer los derechos: así una
 * baja de plan no rompe la operación diaria (lo nuevo nace en el estándar) y no reinterpreta lo
 * existente. Cada módulo arma `habilitados` con sus interruptores, y el estándar está siempre. Pura:
 * sin reloj ni azar.
 */
export function nivelParaLoNuevo<N extends string>(
  e: Readonly<{
    /** El nivel base de la escalera: el que rige si no hay elección o ya no está habilitada. */
    estandar: N;
    /** El nivel que eligió el gerente, o `null` si no eligió. */
    elegido: N | null;
    /** Los niveles que el plan habilita hoy; incluye siempre el estándar. */
    habilitados: ReadonlySet<N>;
  }>,
): N {
  if (e.elegido === null) return e.estandar;
  return e.habilitados.has(e.elegido) ? e.elegido : e.estandar;
}
