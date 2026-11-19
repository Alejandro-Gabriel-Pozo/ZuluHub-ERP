/** Las cajas de la sucursal con su sesión y la jornada de hoy, como las entrega `cajasParaCobrar` (la forma, sin importar de dónde venga). */
export type EstadoDeLasCajas = Readonly<{
  cajas: readonly Readonly<{
    cajaId: string;
    estado: "SIN_SESION" | "ABIERTA" | "EN_CIERRE";
    jornadaVencida: boolean;
  }>[];
  jornadaActual: Readonly<{ estado: "ABIERTA" | "EN_AUDITORIA" | "CERRADA" }>;
}>;

export type DecisionDeLaCaja =
  | Readonly<{ tipo: "LISTA"; cajaId: string }>
  | Readonly<{ tipo: "ABRIR_LA_CAJA" }>
  /** `jornadaAbierta`: si el día de hoy sigue abierto (con el día en cierre o cerrado la venta ni arma la cuenta; maqueta `venta-rapida-v4.html`, `bloqueaAgregar`). */
  | Readonly<{ tipo: "NO_PERMITIDO"; jornadaAbierta: boolean }>;

/**
 * En qué caja se cobra, a partir de las cajas de la sucursal y la jornada de hoy. Nace cerrado (DEC-0502): se cobra solo con UNA caja abierta, de la jornada de hoy, con la jornada abierta. Sin ninguna
 * sesión abierta (todas sin sesión) la pantalla pide abrir la caja; con el día en cierre o cerrado, la caja en cierre, una sesión vencida, ninguna caja o más de una abierta (no se elige una por la persona)
 * es el genérico. Ante la duda cierra: nunca se asume una caja.
 */
export function decidirLaCaja(estado: EstadoDeLasCajas): DecisionDeLaCaja {
  const jornadaAbierta = estado.jornadaActual.estado === "ABIERTA";
  const noPermitido = { tipo: "NO_PERMITIDO", jornadaAbierta } as const;
  if (!jornadaAbierta) return noPermitido;
  const abiertas = estado.cajas.filter((c) => c.estado === "ABIERTA");
  if (abiertas.length > 1) return noPermitido;
  const unica = abiertas[0];
  if (unica !== undefined) {
    return unica.jornadaVencida ? noPermitido : { tipo: "LISTA", cajaId: unica.cajaId };
  }
  if (estado.cajas.length === 0 || estado.cajas.some((c) => c.estado === "EN_CIERRE")) {
    return noPermitido;
  }
  return { tipo: "ABRIR_LA_CAJA" };
}
