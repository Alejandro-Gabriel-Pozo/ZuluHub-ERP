import type { ApoyoDeLaExportacion, MedioDeCobranza } from "../modulos/cuenta_corriente/publico";
import { ORIGEN_DE_LA_COBRANZA_DE_VENTA } from "../modulos/cuenta_corriente/publico";
import type { TxDeApp } from "./conexiones";

/**
 * El adaptador que une la exportación de la cuenta corriente con caja y empresas (CC-4): la composición es el ÚNICO lugar donde se tocan los módulos. Lee, en la MISMA transacción de
 * la exportación, el medio de pago VIGENTE de cada cobro de caja de las cobranzas (el destino de su última corrección de medio, si la hubo) y el nombre de las sucursales. Solo lectura;
 * sin las piezas de caja y de empresas falla cerrado antes de leer.
 */
type PiezasDelApoyo = Pick<TxDeApp, "cobros" | "sucursales">;

function comoPiezas(tx: object): PiezasDelApoyo {
  for (const pieza of ["cobros", "sucursales"] as const) {
    if (!Object.hasOwn(tx, pieza)) {
      throw new Error(`la transacción de la exportación no trae la pieza «${pieza}»`);
    }
  }
  return tx as PiezasDelApoyo;
}

export function crearApoyoDeLaExportacionDeCuentaCorriente(): ApoyoDeLaExportacion<object> {
  return {
    async mediosDeCobranza(tx, empresa, cobranzaIds) {
      const { cobros } = comoPiezas(tx);
      const filas = await cobros.deVariosOrigenes(
        empresa,
        ORIGEN_DE_LA_COBRANZA_DE_VENTA,
        cobranzaIds,
      );
      const porCobranza = new Map<string, MedioDeCobranza[]>();
      for (const c of filas) {
        const vigente = c.correcciones.at(-1)?.medioDespuesTipo ?? c.medioTipo;
        const lista = porCobranza.get(c.origenId) ?? [];
        lista.push({ orden: c.origenOrden, tipoDeMedio: vigente, importe: c.importe });
        porCobranza.set(c.origenId, lista);
      }
      return porCobranza;
    },
    async nombresDeSucursales(tx, empresa, sucursalIds) {
      const { sucursales } = comoPiezas(tx);
      const pedidas = new Set(sucursalIds);
      return new Map(
        (await sucursales.listar(empresa))
          .filter((s) => pedidas.has(s.id))
          .map((s) => [s.id, s.nombre]),
      );
    },
  };
}
