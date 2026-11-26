import { formatearFecha, formatearImporte } from "../../../patrones/formato-fiscal";
import { rutaDeCargarNota, type ClaseDeNotaParaLaRuta } from "../rutas-de-compras";
import type { TextosDeNotas } from "./textos-de-notas";

/**
 * El modelo de vista de las pantallas de notas del proveedor (NOTAS-2c-1; maqueta `servicios-y-bienes-de-uso.html`, pantallas 9 y 10). Puro: sin React ni servidor. NO calcula ningún importe: el total, lo acreditado, lo debitado,
 * el neto a pagar y el saldo a favor los entrega el servidor y acá solo se les da forma (dinero siempre como TEXTO decimal, nunca `number`). Lo único que decide es qué se ofrece: cada botón nace cerrado y se abre con el
 * permiso de su acción (cada acción vuelve a pasar por el guard del servidor: mostrar no es autorizar).
 */

/** Lo que devuelve la lectura de las notas de una factura (la misma forma que `NotasDeLaFacturaParaLaPantalla` de la composición: la interfaz no importa la composición). */
export type NotasParaLaPantalla = Readonly<{
  facturaId: string;
  tipo: string | null;
  puntoDeVenta: number | null;
  numero: number | null;
  totalDeLaFactura: string;
  acreditado: string;
  debitado: string;
  netoAPagar: string;
  saldoAFavorPendiente: string | null;
  notas: readonly Readonly<{
    comprobanteId: string;
    clase: "NOTA_DE_CREDITO" | "NOTA_DE_DEBITO";
    tipo: string;
    puntoDeVenta: number;
    numero: number;
    fechaNegocio: string;
    total: string;
    estado: string;
  }>[];
}>;

/** Lo que la persona puede hacer con las notas; sin decirlo, nada (todo nace cerrado). */
export type AccionesDeLasNotas = Readonly<{
  registrarCredito: boolean;
  registrarDebito: boolean;
  anularCredito: boolean;
  anularDebito: boolean;
}>;
export const SIN_ACCIONES_DE_LAS_NOTAS: AccionesDeLasNotas = {
  registrarCredito: false,
  registrarDebito: false,
  anularCredito: false,
  anularDebito: false,
};

/** El importe del que no hay nada para pagar: el neto que manda el servidor con dos decimales. */
export const NETO_CERO = "0.00";

/** Una letra del comprobante tal cual la imprime el papel: `NOTA_CREDITO_A` → `A`. */
const letraDelTipo = (tipo: string): string => tipo.slice(-1);

export type FilaDeNota = Readonly<{
  id: string;
  clase: "NOTA_DE_CREDITO" | "NOTA_DE_DEBITO";
  /** «Nota de crédito · A 0003-00000077 · 27/11/2026». */
  titulo: string;
  importe: string;
  estado: string;
  vigente: boolean;
  /** Se ofrece «Anular»: la nota está vigente y la persona tiene el permiso de su clase. */
  anulable: boolean;
}>;

export type PantallaDeNotasArmada = Readonly<{
  titulo: string;
  resumen: readonly Readonly<{ rotulo: string; valor: string }>[];
  /** «Saldada por notas» o «Saldo a favor» (con su importe); `null` si no corresponde ninguno. */
  situacion: Readonly<{ texto: string; importe: string | null }> | null;
  filas: readonly FilaDeNota[];
  cargarCredito: Readonly<{ texto: string; href: string }> | null;
  cargarDebito: Readonly<{ texto: string; href: string }> | null;
}>;

/** «A 0003-00012345», con la letra del tipo, el punto de venta de cuatro cifras y el número de ocho. Sin tipo o sin numeración no se inventa nada: queda vacío. */
export function nombreDelComprobante(
  tipo: string | null,
  puntoDeVenta: number | null,
  numero: number | null,
): string {
  if (tipo === null || puntoDeVenta === null || numero === null) return "";
  return `${letraDelTipo(tipo)} ${String(puntoDeVenta).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}

/** Si la factura quedó saldada por sus notas: el neto es cero y no hay un pago vigente que lo supere (en ese caso lo que queda es saldo a favor). */
export const quedoSaldadaPorNotas = (datos: NotasParaLaPantalla): boolean =>
  datos.netoAPagar === NETO_CERO && datos.saldoAFavorPendiente === null;

export function armarLaPantallaDeNotas(
  datos: NotasParaLaPantalla,
  textos: TextosDeNotas,
  acciones: AccionesDeLasNotas,
): PantallaDeNotasArmada {
  const nombre = nombreDelComprobante(datos.tipo, datos.puntoDeVenta, datos.numero);
  return {
    titulo: nombre === "" ? textos.titulo : `${textos.titulo} ${nombre}`,
    resumen: [
      { rotulo: textos.totalDeLaFactura, valor: formatearImporte(datos.totalDeLaFactura) },
      {
        rotulo: textos.creditosVigentes,
        valor: `− ${formatearImporte(datos.acreditado)}`,
      },
      {
        rotulo: textos.debitosVinculados,
        valor: `+ ${formatearImporte(datos.debitado)}`,
      },
      { rotulo: textos.importeAPagar, valor: formatearImporte(datos.netoAPagar) },
    ],
    situacion: quedoSaldadaPorNotas(datos)
      ? { texto: textos.saldadaPorNotas, importe: null }
      : datos.saldoAFavorPendiente === null
        ? null
        : { texto: textos.saldoAFavor, importe: formatearImporte(datos.saldoAFavorPendiente) },
    filas: datos.notas.map((n) => {
      const credito = n.clase === "NOTA_DE_CREDITO";
      const vigente = n.estado === "REGISTRADO";
      return {
        id: n.comprobanteId,
        clase: n.clase,
        titulo: `${credito ? textos.notaDeCredito : textos.notaDeDebito} · ${nombreDelComprobante(
          n.tipo,
          n.puntoDeVenta,
          n.numero,
        )} · ${formatearFecha(n.fechaNegocio)}`,
        importe: formatearImporte(n.total),
        estado: vigente ? textos.vigente : textos.anulada,
        vigente,
        anulable: vigente && (credito ? acciones.anularCredito : acciones.anularDebito),
      };
    }),
    cargarCredito: acciones.registrarCredito
      ? { texto: textos.cargarNotaDeCredito, href: rutaDeCargarNota(datos.facturaId, "credito") }
      : null,
    cargarDebito: acciones.registrarDebito
      ? { texto: textos.cargarNotaDeDebito, href: rutaDeCargarNota(datos.facturaId, "debito") }
      : null,
  };
}

/** Los tipos que se ofrecen para cada clase: los tres de la letra A, B y C (la lista del dominio es `TIPOS_DE_COMPROBANTE_DE_PROVEEDOR`; la prueba `modelo-de-notas.test.ts` falla si difieren). */
export const TIPOS_DE_NOTA_POR_CLASE: Readonly<Record<ClaseDeNotaParaLaRuta, readonly string[]>> = {
  credito: ["NOTA_CREDITO_A", "NOTA_CREDITO_B", "NOTA_CREDITO_C"],
  debito: ["NOTA_DEBITO_A", "NOTA_DEBITO_B", "NOTA_DEBITO_C"],
};

/** La clase que dice la dirección: solo `credito` o `debito`; cualquier otra cosa no abre la pantalla. */
export function claseDeLaDireccion(valor: unknown): ClaseDeNotaParaLaRuta | null {
  return valor === "credito" || valor === "debito" ? valor : null;
}
