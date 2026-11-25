import {
  proponerConciliacionDentro,
  type PropuestaDeConciliacion,
} from "../casos-de-uso/proponer-conciliacion";
import {
  fichaDeRecepcionSeparadaDentro,
  listarFacturasSeparadasDentro,
  listarRecepcionesSeparadasDentro,
  type EntradaDeListarSeparadas,
  type FichaDeRecepcionSeparada,
  type FacturaSeparadaDeLista,
  type PaginaDe,
  type RecepcionSeparadaDeLista,
} from "../casos-de-uso/lectura-separada";
import {
  conciliacionesDeFacturaDentro,
  fichaDeFacturaSeparadaDentro,
  type ConciliacionDeFactura,
  type FichaDeFacturaSeparada,
} from "../casos-de-uso/lectura-de-factura";
import { type Lector, type RDeConsulta } from "./comun";

export type {
  ConciliacionDeFactura,
  FichaDeFacturaSeparada,
  FichaDeRecepcionSeparada,
  PropuestaDeConciliacion,
  EntradaDeListarSeparadas,
  FacturaSeparadaDeLista,
  PaginaDe,
  RecepcionSeparadaDeLista,
};

export function armarConsultasDeConciliacion(leer: Lector) {
  return {
    /** Las recepciones de N3 y N4 con su estado derivado, de la más nueva a la más vieja, paginadas por cursor (guard `recepciones.ver`, en el alcance de sucursales de quien pide). */
    listarRecepcionesSeparadas(
      contexto: Parameters<Lector>[0],
      entrada: EntradaDeListarSeparadas = {},
    ): Promise<RDeConsulta<PaginaDe<RecepcionSeparadaDeLista>>> {
      return leer(contexto, ["recepciones.ver"], (tx) =>
        listarRecepcionesSeparadasDentro(tx, contexto, entrada),
      ).then((r) => (r.ok ? r.valor : r));
    },
    /** La ficha de una recepción de N3 o N4 (guard `recepciones.ver`); `null` si no existe, no es de recepción separada o es de una sucursal fuera del alcance. */
    fichaDeRecepcionSeparada(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ recepcionId: string }>,
    ): Promise<RDeConsulta<FichaDeRecepcionSeparada | null>> {
      return leer(contexto, ["recepciones.ver"], (tx) =>
        fichaDeRecepcionSeparadaDentro(tx, contexto, entrada),
      ).then((r) => (r.ok ? r.valor : r));
    },
    /** Las facturas de N3 y N4 con su estado derivado («Facturada, falta recibir», conciliada, anulada), paginadas por cursor (guard `comprobantes_de_proveedor.ver`). */
    listarFacturasSeparadas(
      contexto: Parameters<Lector>[0],
      entrada: EntradaDeListarSeparadas = {},
    ): Promise<RDeConsulta<PaginaDe<FacturaSeparadaDeLista>>> {
      return leer(contexto, ["comprobantes_de_proveedor.ver"], (tx) =>
        listarFacturasSeparadasDentro(tx, contexto, entrada),
      ).then((r) => (r.ok ? r.valor : r));
    },
    /** El detalle de una factura de N3 o N4 (guard `comprobantes_de_proveedor.ver`): lo facturado, lo conciliado y lo recibido por sucursal del alcance, y las conciliaciones hechas; `null` si no existe o no es de N3 o N4. */
    fichaDeFacturaSeparada(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ comprobanteId: string }>,
    ): Promise<RDeConsulta<FichaDeFacturaSeparada | null>> {
      return leer(contexto, ["comprobantes_de_proveedor.ver"], (tx) =>
        fichaDeFacturaSeparadaDentro(tx, contexto, entrada),
      ).then((r) => (r.ok ? r.valor : r));
    },
    /** Las conciliaciones hechas de una factura de N3 o N4, solo las que repartieron alguna sucursal del alcance de quien pide (guard `conciliaciones.ver`: el operador no las ve); `null` si no existe o no es de N3 o N4. */
    conciliacionesDeFactura(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ comprobanteId: string }>,
    ): Promise<RDeConsulta<readonly ConciliacionDeFactura[] | null>> {
      return leer(contexto, ["conciliaciones.ver"], (tx) =>
        conciliacionesDeFacturaDentro(tx, contexto, entrada),
      ).then((r) => (r.ok ? r.valor : r));
    },
    /** Lo que necesita la pantalla de conciliar y la propuesta de un toque, limitadas al alcance de sucursales de quien pide (guard `conciliaciones.ver`); `null` si no existe o no es de N3 o N4. una factura de N3 o N4 (guard `conciliaciones.ver`); `null` si no existe o no es de N3 o N4. */
    proponerConciliacion(
      contexto: Parameters<Lector>[0],
      entrada: Readonly<{ comprobanteId: string }>,
    ): Promise<RDeConsulta<PropuestaDeConciliacion | null>> {
      return leer(contexto, ["conciliaciones.ver"], (tx) =>
        proponerConciliacionDentro(tx, contexto, entrada),
      );
    },
  };
}
