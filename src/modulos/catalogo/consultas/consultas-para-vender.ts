import { exigirSucursal } from "../../../capacidades/permisos/alcance";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { DependenciasDeConsultasDeCatalogo } from "../casos-de-uso/contrato";
import type { ErrorDeCatalogo } from "../casos-de-uso/errores";
import { paginaParaVender, type PaginaParaVender } from "../casos-de-uso/productos-para-vender";
import { FORMA_DE_UUID } from "../persistencia/filas";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeProductosParaVender = Readonly<{
  sucursalId: string;
  despuesDe?: Readonly<{ nombreClave: string; id: string }> | undefined;
}>;

/**
 * Las consultas del mostrador sobre el catálogo (E4 §3, D-S2-5): LECTURA PURA (`read committed`), con `productos.ver` y la sucursal dentro del alcance de quien pide. No escriben nada.
 */
export function crearConsultasParaVender(d: DependenciasDeConsultasDeCatalogo) {
  return {
    /**
     * Los productos que el mostrador ofrece en UNA sucursal, en páginas de `TAMANO_DE_PAGINA_PARA_VENDER` por `(nombre_clave, id)`, con su precio (el de la sucursal si lo tiene; si no, el de
     * la empresa: el mismo `precio_vigente` y la misma cuenta que `cotizarParaVender`), medidas, opciones y recargos. Solo entran los que `cotizarParaVender` aceptaría: activos, de clase
     * que se vende, con alícuota y completos; **los ocultos (por la empresa o por el local) no entran** (dueño, 12/11/2026: oculto = «ni en carta/pos»; «agotado» es «ocultar en este local»), ni los
     * de otra empresa. La sucursal es obligatoria: nunca se asume «todas»; una ajena al alcance, inexistente o cerrada falla cerrada. Dinero siempre como texto decimal.
     */
    productosParaVender: (
      contexto: ContextoOperativo,
      entrada: EntradaDeProductosParaVender,
    ): Promise<R<PaginaParaVender>> =>
      d.transacciones.ejecutar(
        { contexto, aislamiento: "read committed", soloLectura: true },
        async (tx): Promise<R<PaginaParaVender>> => {
          const permiso = await exigirAccion(
            d.reglas,
            DECLARACIONES_DE_CONSULTAS.productosParaVender.accion,
            () => tx.autorizacion.delActor(contexto),
          );
          if (!permiso.ok) return permiso;
          if (!FORMA_DE_UUID.test(entrada.sucursalId)) return err("SUCURSAL_NO_ENCONTRADA");
          if (entrada.despuesDe !== undefined && !FORMA_DE_UUID.test(entrada.despuesDe.id))
            return err("IDENTIFICADOR_INVALIDO");
          const sucursal = sucursalId(entrada.sucursalId);
          const dentro = exigirSucursal(
            await tx.autorizacion.sucursalesDelActor(contexto),
            sucursal,
          );
          if (!dentro.ok) return dentro;
          const local = await tx.sucursales.obtener(contexto.empresaId, sucursal);
          if (local === null) return err("SUCURSAL_NO_ENCONTRADA");
          if (!local.activa) return err("SUCURSAL_INACTIVA");

          return ok(await paginaParaVender(tx, contexto, sucursal, entrada.despuesDe));
        },
      ),
  };
}
