import { exigirSucursal } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { alcanceParaMirar, exigirPermisoDeConsulta, type ErrorDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type EntradaDeOpcionesDeApertura = Readonly<{ cajaId: string }>;

export type OpcionesDeApertura = Readonly<{
  cajaId: string;
  /** El efectivo contado en el último cierre de esa caja (billetes + monedas), o `null` si nunca se cerró: el formulario queda vacío. */
  fondoSugerido: ImporteJson | null;
}>;

export type ErrorAlConsultarOpcionesDeApertura =
  ErrorDeConsulta | "CAJA_NO_ENCONTRADA" | ErrorDePersistencia;

/**
 * Lo que necesita el formulario de abrir caja (e3 §3.2 y §3.10): el fondo sugerido es el efectivo contado del último cierre de ESA caja o
 * vacío, nunca un valor fijo (el prototipo ponía siempre 15.000). `cajas.ver`, `read committed`, alcance de la sucursal de la caja.
 */
export function armarOpcionesDeApertura({ transacciones, reglas }: DependenciasDeConsultasDeCaja) {
  return async function opcionesDeApertura(
    contexto: ContextoOperativo,
    entrada: EntradaDeOpcionesDeApertura,
  ): Promise<Resultado<OpcionesDeApertura, ErrorAlConsultarOpcionesDeApertura>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<Resultado<OpcionesDeApertura, ErrorDeConsulta | "CAJA_NO_ENCONTRADA">> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.opcionesDeApertura.accion,
        );
        if (!permiso.ok) return permiso;
        const caja = await tx.cajas.obtener(contexto.empresaId, entrada.cajaId);
        if (caja === null) return err("CAJA_NO_ENCONTRADA");
        const dentro = exigirSucursal(await alcanceParaMirar(tx, contexto), caja.sucursalId);
        if (!dentro.ok) return dentro;
        const ultimo = await tx.arqueos.ultimoEfectivoContadoDeLaCaja(contexto.empresaId, caja.id);
        return ok({
          cajaId: caja.id,
          fondoSugerido: ultimo === null ? null : importeAJson(ultimo),
        });
      },
    );
  };
}
