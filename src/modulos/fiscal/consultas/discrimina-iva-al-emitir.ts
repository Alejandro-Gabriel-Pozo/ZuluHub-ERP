import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { versionVigente } from "../dominio/vigencia";
import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * Lo único que la pantalla de Emitir necesita de los datos fiscales del emisor: si el comprobante discrimina IVA, para saber si pide
 * la alícuota de cada renglón (letra C: ninguna; las otras: una por renglón). Es un SÍ o un NO: ni la condición ante IVA, ni la
 * letra, ni el CUIT, ni el domicilio, ni nada más de los datos fiscales sale de acá (hoy esos datos los lee solo quien tiene
 * `datos_fiscales.editar`, y esta lectura no los ablanda).
 */
export type DiscriminaIvaAlEmitir = Readonly<{ discriminaIva: boolean }>;

export type ErrorAlVerSiDiscriminaIva =
  MotivoDeRechazo | "EMISOR_NO_ENCONTRADO" | "SIN_DATOS_FISCALES_VIGENTES" | ErrorDePersistencia;

/**
 * ¿La empresa discrimina IVA al emitir? Pide `comprobantes.emitir_manual` al guard dentro de su transacción (`read committed`, solo
 * lectura), la misma acción de emitir una factura: no se creó un permiso nuevo. Mira los datos fiscales VIGENTES hoy del emisor
 * PRINCIPAL (D-47: la primera versión trabaja con un solo emisor), los mismos que usa emitir (`emitir-comprobante.ts`). Sin datos
 * vigentes responde `SIN_DATOS_FISCALES_VIGENTES`, el mismo error que daría emitir.
 *
 * La regla es la de la letra (`letraParaFactura`, spec H7 facturación §B.3.1): solo un emisor responsable inscripto emite A o B, que
 * discriminan; monotributo y exento emiten C, que no. Está escrita acá y en el dominio porque una consulta no importa el dominio
 * (regla `consultas-sin-dominio`); `consultas.test.ts` las compara para TODAS las condiciones del emisor y del receptor, y si una
 * cambia sin la otra esa prueba falla. Previene: que la pantalla pida alícuota en una factura C (`ALICUOTA_EN_LETRA_C`) o no la pida
 * en una A o B (`FALTA_ALICUOTA`).
 */
export function armarDiscriminaIvaAlEmitir({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeFacturacion) {
  return async function discriminaIvaAlEmitir(
    contexto: ContextoOperativo,
  ): Promise<Resultado<DiscriminaIvaAlEmitir, ErrorAlVerSiDiscriminaIva>> {
    const { empresaId, ahora } = contexto;
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<
          DiscriminaIvaAlEmitir,
          MotivoDeRechazo | "EMISOR_NO_ENCONTRADO" | "SIN_DATOS_FISCALES_VIGENTES"
        >
      > => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.discriminaIvaAlEmitir.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const emisor = await tx.emisores.delPrincipal(empresaId);
        if (emisor === null) return err("EMISOR_NO_ENCONTRADO");
        const datos = versionVigente(
          await tx.datosFiscales.confirmadas(empresaId, emisor.id),
          ahora,
        );
        if (datos === null) return err("SIN_DATOS_FISCALES_VIGENTES");
        return ok({ discriminaIva: datos.condicionIva === "RESPONSABLE_INSCRIPTO" });
      },
    );
  };
}
